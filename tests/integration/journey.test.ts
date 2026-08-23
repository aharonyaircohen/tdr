// End-to-end integration test of the chat turn endpoint + resume flow against
// a real SQLite database. Each test seeds the schema fresh and exercises
// `sendTurn` and `pickResumeLesson` together.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import {
  summariseCourseProgress,
  pickRecentActiveCourse,
  pickResumeLesson,
  canEnterLesson,
} from "@/lib/progress";
import { listCourses } from "@/lib/service";
import { retryFeedback, parseScript } from "@/lib/script";

const testDbPath = path.resolve(process.cwd(), "prisma/test.db");

function freshDb() {
  for (const ext of ["", "-journal"]) {
    try {
      fs.unlinkSync(testDbPath + ext);
    } catch {
      // ignore
    }
  }
  // Prisma cannot create a missing SQLite file on every supported filesystem,
  // but it can initialize an existing empty file.
  fs.closeSync(fs.openSync(testDbPath, "a"));
  // Schema path is relative to the schema file, so "./test.db" inside the
  // .env.test maps to prisma/test.db.
  try {
    execSync("npx prisma db push --skip-generate --accept-data-loss", {
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: "file:./test.db" },
    });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
    const out = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
    throw new Error(
      `prisma db push failed (exit ${err.status ?? "?"}):\n${out}\n` +
        `DATABASE_URL=file:./test.db resolves to ${testDbPath}.`,
    );
  }
}

let prisma: PrismaClient;
let sendTurn: typeof import("@/lib/service").sendTurn;
let pickResumeLesson: typeof import("@/lib/progress").pickResumeLesson;
let pickRecentActiveCourse: typeof import("@/lib/progress").pickRecentActiveCourse;
let summariseCourseProgress: typeof import("@/lib/progress").summariseCourseProgress;
let canEnterLesson: typeof import("@/lib/progress").canEnterLesson;
let listCourses: typeof import("@/lib/service").listCourses;

beforeAll(() => {
  // Ensure the schema exists before any test runs.
  freshDb();
});

beforeEach(async () => {
  // Re-import per test so the singleton client picks up the fresh DB.
  // The db.ts module is cached after first import, so we re-bind it via
  // a fresh require() each time and reset any existing connection.
  const dbMod = await import("@/lib/db");
  await dbMod.prisma.$disconnect();
  const svc = await import("@/lib/service");
  const prog = await import("@/lib/progress");
  prisma = dbMod.prisma;
  sendTurn = svc.sendTurn;
  pickResumeLesson = prog.pickResumeLesson;
  pickRecentActiveCourse = prog.pickRecentActiveCourse;
  summariseCourseProgress = prog.summariseCourseProgress;
  canEnterLesson = prog.canEnterLesson;
  listCourses = svc.listCourses;

  // Wipe data between tests (schema already exists from beforeAll).
  await prisma.message.deleteMany();
  await prisma.progress.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.course.deleteMany();
});

afterAll(async () => {
  await prisma?.$disconnect();
});

async function seedFixtures() {
  const course = await prisma.course.create({
    data: {
      slug: "intro",
      title: "Intro",
      description: "Test course",
    },
  });
  const script = JSON.stringify([
    { kind: "tutor", content: "Hi, ready?" },
    { kind: "learner", prompt: "ready", expect: ["yes", "ready"] },
    { kind: "tutor", content: "Great — you are ready." },
    {
      kind: "learner",
      prompt: "complete",
      expect: ["done", "ok"],
    },
    { kind: "tutor", content: "Lesson complete." },
  ]);
  const lessons = await Promise.all([
    prisma.lesson.create({
      data: {
        courseId: course.id,
        slug: "lesson-1",
        title: "Lesson 1",
        order: 1,
        script,
      },
    }),
    prisma.lesson.create({
      data: {
        courseId: course.id,
        slug: "lesson-2",
        title: "Lesson 2",
        order: 2,
        script: JSON.stringify([
          { kind: "tutor", content: "Lesson two intro." },
          { kind: "learner", prompt: "ready", expect: ["ok", "yes"] },
          { kind: "tutor", content: "Lesson two complete." },
        ]),
      },
    }),
  ]);
  return { course, lessons };
}

describe("development reset", () => {
  it("leaves messages and progress empty until a learner enters a lesson", async () => {
    const { lessons } = await seedFixtures();
    await prisma.message.create({
      data: {
        lessonId: lessons[0].id,
        learnerId: "reset-learner",
        role: "tutor",
        content: "existing opening",
      },
    });
    await prisma.progress.create({
      data: {
        lessonId: lessons[0].id,
        learnerId: "reset-learner",
        completed: false,
      },
    });

    process.env.ALLOW_DEV_RESET = "true";
    const resetRoute = await import("@/app/api/dev/reset/route");
    const response = await resetRoute.POST();

    expect(response.status).toBe(200);
    expect(await prisma.message.count()).toBe(0);
    expect(await prisma.progress.count()).toBe(0);
  });
});

describe("sendTurn + resume flow", () => {
  it("seeds exactly one opening tutor message under concurrent retries", async () => {
    const { lessons } = await seedFixtures();
    const { POST } = await import("@/app/api/lessons/[lessonId]/seed/route");
    const context = { params: Promise.resolve({ lessonId: lessons[0].id }) };

    const [first, second] = await Promise.all([
      POST(new Request("http://localhost/seed", { method: "POST" }), context),
      POST(new Request("http://localhost/seed", { method: "POST" }), context),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await prisma.message.count({ where: { lessonId: lessons[0].id } })).toBe(1);
  });

  it("walks the full scripted lesson and marks it complete", async () => {
    const { lessons } = await seedFixtures();
    const learner = "test-learner";

    const r1 = await sendTurn({
      lessonId: lessons[0].id,
      learnerId: learner,
      content: "yes",
    });
    expect(r1.tutorMessage.content).toBe("Great — you are ready.");
    expect(r1.isComplete).toBe(false);

    const r2 = await sendTurn({
      lessonId: lessons[0].id,
      learnerId: learner,
      content: "done",
    });
    expect(r2.isComplete).toBe(true);

    const progress = await prisma.progress.findUnique({
      where: { learnerId_lessonId: { learnerId: learner, lessonId: lessons[0].id } },
    });
    expect(progress?.completed).toBe(true);
  });

  it("resume picks the next unfinished lesson after one completes", async () => {
    const { course, lessons } = await seedFixtures();
    const learner = "test-learner";

    await sendTurn({
      lessonId: lessons[0].id,
      learnerId: learner,
      content: "yes",
    });
    await sendTurn({
      lessonId: lessons[0].id,
      learnerId: learner,
      content: "done",
    });

    const courseWithLessons = await prisma.course.findUnique({
      where: { id: course.id },
      include: {
        lessons: {
          orderBy: { order: "asc" },
          include: { progress: { where: { learnerId: learner } } },
        },
      },
    });
    const resume = pickResumeLesson(courseWithLessons!.lessons, learner);
    expect(resume?.id).toBe(lessons[1].id);
  });

  it("writing a learner turn creates a progress row", async () => {
    const { lessons } = await seedFixtures();
    const learner = "test-learner";

    await sendTurn({
      lessonId: lessons[0].id,
      learnerId: learner,
      content: "yes",
    });

    const progress = await prisma.progress.findUnique({
      where: { learnerId_lessonId: { learnerId: learner, lessonId: lessons[0].id } },
    });
    expect(progress).not.toBeNull();
    expect(progress?.completed).toBe(false);
  });

  it("is idempotent on the seed script: re-seeding doesn't duplicate content", async () => {
    const { lessons } = await seedFixtures();
    const before = await prisma.message.count({
      where: { lessonId: lessons[0].id },
    });
    // Re-run the same script via upsert.
    await prisma.lesson.update({
      where: { id: lessons[0].id },
      data: {
        script: lessons[0].script,
      },
    });
    const after = await prisma.message.count({
      where: { lessonId: lessons[0].id },
    });
    expect(after).toBe(before);
  });

  it("persists wrong learner turns and recovers when the learner retries with a matching answer", async () => {
    const { lessons } = await seedFixtures();
    const lessonId = lessons[0].id;
    const learner = "test-learner";

    // First learner turn is wrong — engine should surface retry feedback
    // that names the scripted prompt, not the old generic nudge.
    const wrong = await sendTurn({
      lessonId,
      learnerId: learner,
      content: "watermelon",
    });
    expect(wrong.isComplete).toBe(false);
    const script = parseScript(lessons[0].script);
    const firstLearnerStep = script.find((s) => s.kind === "learner");
    expect(firstLearnerStep).toBeDefined();
    if (firstLearnerStep?.kind !== "learner") throw new Error("setup");
    expect(wrong.tutorMessage.content).toBe(
      retryFeedback(firstLearnerStep.prompt),
    );
    // The wrong learner turn AND the retry feedback must both be persisted.
    const messagesAfterWrong = await prisma.message.findMany({
      where: { lessonId },
      orderBy: { createdAt: "asc" },
    });
    expect(messagesAfterWrong.map((m) => m.role)).toEqual([
      "tutor",
      "learner",
      "tutor",
    ]);
    expect(messagesAfterWrong[1].content).toBe("watermelon");
    expect(messagesAfterWrong[2].content).toBe(wrong.tutorMessage.content);

    // A second wrong answer still surfaces retry feedback, not completion.
    const wrongAgain = await sendTurn({
      lessonId,
      learnerId: learner,
      content: "potato",
    });
    expect(wrongAgain.isComplete).toBe(false);
    expect(wrongAgain.tutorMessage.content).toBe(
      retryFeedback(firstLearnerStep.prompt),
    );

    // Now the matching retry — engine must walk past the two wrong turns
    // and the retry-feedback tutor turns to advance the lesson.
    const recovered = await sendTurn({
      lessonId,
      learnerId: learner,
      content: "yes",
    });
    expect(recovered.isComplete).toBe(false);
    expect(recovered.tutorMessage.content).toBe("Great — you are ready.");

    // Finish the lesson normally to prove the recovery path leads to the
    // same completion behavior as a clean walkthrough.
    const finished = await sendTurn({
      lessonId,
      learnerId: learner,
      content: "done",
    });
    expect(finished.isComplete).toBe(true);
    expect(finished.tutorMessage.content).toContain("Lesson complete");

    const allMessages = await prisma.message.findMany({
      where: { lessonId },
      orderBy: { createdAt: "asc" },
    });
    // The wrong turns stay visible — nothing is deleted, just left in the
    // transcript as part of the learner’s recovery path. The closing
    // tutor line is persisted like every other tutor turn, so the
    // completed transcript survives a refresh.
    expect(allMessages.map((m) => m.role)).toEqual([
      "tutor", // opening
      "learner", // wrong 1
      "tutor", // retry feedback 1
      "learner", // wrong 2
      "tutor", // retry feedback 2
      "learner", // correct retry
      "tutor", // advance
      "learner", // "done"
      "tutor", // closing line (persisted)
    ]);
    expect(allMessages[1].content).toBe("watermelon");
    expect(allMessages[3].content).toBe("potato");
    expect(allMessages[5].content).toBe("yes");
    expect(allMessages[8].role).toBe("tutor");
    expect(allMessages[8].content).toBe("Lesson complete.");
    // The final tutor message must be a real persisted row, not the
    // in-memory terminal-<timestamp> placeholder the bug used to fabricate.
    expect(allMessages[8].id).not.toMatch(/^terminal-/);

    const progress = await prisma.progress.findUnique({
      where: { learnerId_lessonId: { learnerId: learner, lessonId } },
    });
    expect(progress?.completed).toBe(true);
  });

  it("persisted wrong turns do not poison replay after a refresh — the lesson resumes and the next correct reply advances", async () => {
    const { lessons } = await seedFixtures();
    const lessonId = lessons[0].id;
    const learner = "test-learner";

    // Persist a wrong turn and the resulting retry feedback.
    await sendTurn({
      lessonId,
      learnerId: learner,
      content: "watermelon",
    });

    // Simulate the learner closing the tab and coming back — the engine must
    // load the persisted transcript (with the wrong turn in it) and still
    // accept a matching retry on the next send.
    const messagesOnReopen = await prisma.message.findMany({
      where: { lessonId },
      orderBy: { createdAt: "asc" },
    });
    expect(messagesOnReopen.map((m) => m.role)).toEqual([
      "tutor",
      "learner",
      "tutor",
    ]);
    expect(messagesOnReopen[1].content).toBe("watermelon");

    const recovered = await sendTurn({
      lessonId,
      learnerId: learner,
      content: "yes",
    });
    expect(recovered.isComplete).toBe(false);
    expect(recovered.tutorMessage.content).toBe("Great — you are ready.");
  });
});

describe("completed lesson transcript stability", () => {
  // Issue #15: once a learner's lesson progress is complete, the transcript
  // must be immutable. The final scripted tutor reply must be persisted like
  // every other tutor turn, and any further learner turn must be rejected
  // without inserting anything.

  it("persists the final scripted tutor reply and keeps it visible after reload", async () => {
    const { lessons } = await seedFixtures();
    const learner = "test-learner";
    const lessonId = lessons[0].id;

    await sendTurn({ lessonId, learnerId: learner, content: "yes" });
    const finishing = await sendTurn({
      lessonId,
      learnerId: learner,
      content: "done",
    });
    expect(finishing.isComplete).toBe(true);

    // The closing tutor line MUST be a persisted Message row, not an
    // in-memory fabricated id. The engine returns the scripted final tutor
    // line "Lesson complete." for this fixture.
    expect(finishing.tutorMessage.id).not.toMatch(/^terminal-/);
    expect(finishing.tutorMessage.content).toBe("Lesson complete.");

    // Simulate a reload: the transcript is read straight from storage.
    const persisted = await prisma.message.findMany({
      where: { lessonId },
      orderBy: { createdAt: "asc" },
    });
    expect(persisted.map((m) => m.role)).toEqual([
      "tutor", // opening
      "learner", // "yes"
      "tutor", // "Great — you are ready."
      "learner", // "done"
      "tutor", // closing line — persisted
    ]);
    expect(persisted[4].id).toBe(finishing.tutorMessage.id);
    expect(persisted[4].content).toBe("Lesson complete.");
    expect(persisted.every((m) => !m.id.startsWith("terminal-"))).toBe(true);

    // The returned tutor row id and the persisted row id must agree so
    // the client UI's optimistic update never invents a row that the
    // server cannot find.
    const fromDb = await prisma.message.findUnique({
      where: { id: finishing.tutorMessage.id },
    });
    expect(fromDb?.content).toBe("Lesson complete.");
  });

  it("the messages API returns 409 for a post-complete turn and leaves the transcript unchanged", async () => {
    const { lessons } = await seedFixtures();
    const lessonId = lessons[0].id;
    process.env.CURRENT_LEARNER_ID = "test-learner";
    const context = { params: Promise.resolve({ lessonId }) };
    const messageRoute = await import(
      "@/app/api/lessons/[lessonId]/messages/route"
    );
    const completeRoute = await import(
      "@/app/api/lessons/[lessonId]/complete/route"
    );

    // Drive the lesson to completion through the API so the on-disk
    // transcript is exactly what the learner would have produced.
    let res = await messageRoute.POST(
      new Request("http://localhost/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "yes" }),
      }),
      context,
    );
    expect(res.status).toBe(200);
    res = await messageRoute.POST(
      new Request("http://localhost/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "done" }),
      }),
      context,
    );
    expect(res.status).toBe(200);

    const before = await prisma.message.findMany({
      where: { lessonId },
      orderBy: { createdAt: "asc" },
    });
    // The closing tutor line is now a real persisted row.
    expect(before.some((m) => m.role === "tutor" && m.content === "Lesson complete.")).toBe(
      true,
    );

    // A direct API call attempting another learner turn after completion
    // must be rejected with 409 — this proves the UI's disabled composer
    // is enforced at the shared mutation boundary, not just client-side.
    const bypass = await messageRoute.POST(
      new Request("http://localhost/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "post-complete sneak" }),
      }),
      context,
    );
    expect(bypass.status).toBe(409);

    const after = await prisma.message.findMany({
      where: { lessonId },
      orderBy: { createdAt: "asc" },
    });
    expect(after.length).toBe(before.length);
    expect(after.map((m) => m.id)).toEqual(before.map((m) => m.id));
    expect(after.map((m) => m.content)).toEqual(before.map((m) => m.content));

    // Sanity: the explicit complete endpoint still works for already-complete
    // lessons (it is upsert).
    const completeAgain = await completeRoute.POST(
      new Request("http://localhost/complete", { method: "POST" }),
      context,
    );
    expect(completeAgain.status).toBe(200);
  });
});

describe("sequential path gating (canEnterLesson)", () => {
  // Verifies the helper the lesson page uses to decide whether to redirect
  // a direct future-lesson URL. The page redirects when canEnterLesson is
  // false, so the integration assertion is: at each progress state, the
  // locked lessons are exactly the ones with `canEnterLesson === false`,
  // and the resume target the page redirects to is a lesson that IS
  // enterable.
  async function loadCourseWithLessons(learner: string) {
    return prisma.course.findFirstOrThrow({
      include: {
        lessons: {
          orderBy: { order: "asc" },
          include: { progress: { where: { learnerId: learner } } },
        },
      },
    });
  }

  it("lets lesson 1 open without any progress, but locks lesson 2", async () => {
    const { lessons } = await seedFixtures();
    const learner = "test-learner";
    const course = await loadCourseWithLessons(learner);
    expect(canEnterLesson(course.lessons, learner, lessons[0].id)).toBe(true);
    expect(canEnterLesson(course.lessons, learner, lessons[1].id)).toBe(false);
    // The redirect target must be enterable — i.e. lesson 1.
    const resume = pickResumeLesson(course.lessons, learner);
    expect(resume?.id).toBe(lessons[0].id);
    expect(canEnterLesson(course.lessons, learner, resume!.id)).toBe(true);
  });

  it("rejects seed, message, and completion mutations for a locked lesson", async () => {
    const { lessons } = await seedFixtures();
    process.env.CURRENT_LEARNER_ID = "test-learner";
    const context = { params: Promise.resolve({ lessonId: lessons[1].id }) };
    const seedRoute = await import("@/app/api/lessons/[lessonId]/seed/route");
    const messageRoute = await import(
      "@/app/api/lessons/[lessonId]/messages/route"
    );
    const completeRoute = await import(
      "@/app/api/lessons/[lessonId]/complete/route"
    );

    const seedResponse = await seedRoute.POST(
      new Request("http://localhost/seed", { method: "POST" }),
      context,
    );
    const messageResponse = await messageRoute.POST(
      new Request("http://localhost/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "yes" }),
      }),
      context,
    );
    const completeResponse = await completeRoute.POST(
      new Request("http://localhost/complete", { method: "POST" }),
      context,
    );

    expect(seedResponse.status).toBe(409);
    expect(messageResponse.status).toBe(409);
    expect(completeResponse.status).toBe(409);
    expect(await prisma.message.count({ where: { lessonId: lessons[1].id } })).toBe(0);
    expect(await prisma.progress.count({ where: { lessonId: lessons[1].id } })).toBe(0);
  });

  it("still locks lesson 2 while lesson 1 is in-progress but not complete", async () => {
    const { lessons } = await seedFixtures();
    const learner = "test-learner";
    await sendTurn({
      lessonId: lessons[0].id,
      learnerId: learner,
      content: "yes",
    });
    const course = await loadCourseWithLessons(learner);
    expect(canEnterLesson(course.lessons, learner, lessons[1].id)).toBe(false);
    // Resume still points at lesson 1 (in-progress) and that target must
    // remain enterable so the redirect lands somewhere usable.
    const resume = pickResumeLesson(course.lessons, learner);
    expect(resume?.id).toBe(lessons[0].id);
    expect(canEnterLesson(course.lessons, learner, resume!.id)).toBe(true);
  });

  it("unlocks lesson 2 once lesson 1 is complete and stays reviewable", async () => {
    const { lessons } = await seedFixtures();
    const learner = "test-learner";
    await sendTurn({
      lessonId: lessons[0].id,
      learnerId: learner,
      content: "yes",
    });
    await sendTurn({
      lessonId: lessons[0].id,
      learnerId: learner,
      content: "done",
    });
    const course = await loadCourseWithLessons(learner);
    // Both lessons are now enterable: lesson 1 is reviewable, lesson 2 is
    // open. The redirect target (lesson 2) is enterable, so an explicit
    // visit to /lessons/lesson-1 still works without a redirect.
    expect(canEnterLesson(course.lessons, learner, lessons[0].id)).toBe(true);
    expect(canEnterLesson(course.lessons, learner, lessons[1].id)).toBe(true);
    const resume = pickResumeLesson(course.lessons, learner);
    expect(resume?.id).toBe(lessons[1].id);
  });

  it("treats lesson progress from other learners as no progress for gating", async () => {
    const { lessons } = await seedFixtures();
    // Simulate another learner completing lesson 1 — this learner must
    // still see lesson 2 as locked.
    await sendTurn({
      lessonId: lessons[0].id,
      learnerId: "other-learner",
      content: "yes",
    });
    await sendTurn({
      lessonId: lessons[0].id,
      learnerId: "other-learner",
      content: "done",
    });
    const learner = "test-learner";
    const course = await loadCourseWithLessons(learner);
    expect(canEnterLesson(course.lessons, learner, lessons[1].id)).toBe(false);
  });
});

describe("multi-course dashboard helpers", () => {
  async function seedTwoCourses() {
    const courseA = await prisma.course.create({
      data: { slug: "course-a", title: "Course A", description: "A" },
    });
    const courseB = await prisma.course.create({
      data: { slug: "course-b", title: "Course B", description: "B" },
    });
    const scriptA = JSON.stringify([
      { kind: "tutor", content: "A intro" },
      { kind: "learner", prompt: "ready", expect: ["yes", "ok"] },
      { kind: "tutor", content: "A done" },
    ]);
    const scriptB = JSON.stringify([
      { kind: "tutor", content: "B intro" },
      { kind: "learner", prompt: "ready", expect: ["yes", "ok"] },
      { kind: "tutor", content: "B done" },
    ]);
    const lessonsA = await Promise.all([
      prisma.lesson.create({
        data: {
          courseId: courseA.id,
          slug: "a1",
          title: "A1",
          order: 1,
          script: scriptA,
        },
      }),
      prisma.lesson.create({
        data: {
          courseId: courseA.id,
          slug: "a2",
          title: "A2",
          order: 2,
          script: scriptA,
        },
      }),
    ]);
    const lessonsB = await Promise.all([
      prisma.lesson.create({
        data: {
          courseId: courseB.id,
          slug: "b1",
          title: "B1",
          order: 1,
          script: scriptB,
        },
      }),
      prisma.lesson.create({
        data: {
          courseId: courseB.id,
          slug: "b2",
          title: "B2",
          order: 2,
          script: scriptB,
        },
      }),
    ]);
    return { courseA, courseB, lessonsA, lessonsB };
  }

  async function loadCoursesWithLessons(learner: string) {
    return prisma.course.findMany({
      include: {
        lessons: {
          orderBy: { order: "asc" },
          include: { progress: { where: { learnerId: learner } } },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async function seedTwoCoursesInProgress() {
    const seeded = await seedTwoCourses();
    const longScript = JSON.stringify([
      { kind: "tutor", content: "Long intro" },
      { kind: "learner", prompt: "ready", expect: ["yes", "ok"] },
      { kind: "tutor", content: "Long middle" },
      { kind: "learner", prompt: "go", expect: ["go", "next"] },
      { kind: "tutor", content: "Long middle 2" },
      { kind: "learner", prompt: "more", expect: ["more", "continue"] },
      { kind: "tutor", content: "Long done" },
    ]);
    await prisma.lesson.updateMany({ data: { script: longScript } });
    return seeded;
  }

  it("reports independent per-course state with no shared progress", async () => {
    await seedTwoCourses();
    process.env.CURRENT_LEARNER_ID = "iso-learner";
    const learner = process.env.CURRENT_LEARNER_ID;
    const courses = await loadCoursesWithLessons(learner);

    const a = summariseCourseProgress(
      courses.find((c) => c.slug === "course-a")!,
      learner,
    );
    const b = summariseCourseProgress(
      courses.find((c) => c.slug === "course-b")!,
      learner,
    );
    expect(a.state).toBe("not-started");
    expect(b.state).toBe("not-started");
    expect(a.completed).toBe(0);
    expect(b.completed).toBe(0);
    expect(pickRecentActiveCourse(courses, learner)).toBeNull();
  });

  it("isolates progress between courses — completing course A does not move course B", async () => {
    const { lessonsA, lessonsB } = await seedTwoCourses();
    const learner = "iso-learner";
    process.env.CURRENT_LEARNER_ID = learner;

    // Complete course A's first lesson. The script for these fixtures ends
    // with the closing tutor line, so a single matching learner turn
    // completes the lesson.
    await sendTurn({ lessonId: lessonsA[0].id, learnerId: learner, content: "yes" });
    // Make one in-progress turn on course B.
    await sendTurn({ lessonId: lessonsB[0].id, learnerId: learner, content: "yes" });

    const courses = await loadCoursesWithLessons(learner);
    const a = summariseCourseProgress(
      courses.find((c) => c.slug === "course-a")!,
      learner,
    );
    const b = summariseCourseProgress(
      courses.find((c) => c.slug === "course-b")!,
      learner,
    );
    expect(a.state).toBe("in-progress"); // a2 not started
    expect(a.completed).toBe(1);
    expect(b.state).toBe("in-progress");
    expect(b.completed).toBe(1);

    // The Continue card must point at course B (still has activity)
    // rather than course A (whose latest row is older).
    const active = pickRecentActiveCourse(courses, learner);
    expect(active?.slug).toBe("course-b");
  });

  it("pickResumeLesson on course A still resumes lesson a2 after course A is partially done", async () => {
    const { lessonsA } = await seedTwoCourses();
    const learner = "iso-learner";
    process.env.CURRENT_LEARNER_ID = learner;

    await sendTurn({ lessonId: lessonsA[0].id, learnerId: learner, content: "yes" });

    const courses = await loadCoursesWithLessons(learner);
    const courseAFull = courses.find((c) => c.slug === "course-a")!;
    const resume = pickResumeLesson(courseAFull.lessons, learner);
    expect(resume?.slug).toBe("a2");
  });

  it("listCourses exposes per-course state and is isolated by learnerId", async () => {
    await seedTwoCourses();
    process.env.CURRENT_LEARNER_ID = "iso-learner";
    const a = await listCourses();
    expect(a).toHaveLength(2);
    const intro = a.find((c) => c.slug === "course-a")!;
    const prompting = a.find((c) => c.slug === "course-b")!;
    expect(intro.state).toBe("not-started");
    expect(prompting.state).toBe("not-started");
    expect(intro.startLessonSlug).toBe("a1");
    expect(intro.resumeLessonSlug).toBe("a1");
    expect(intro.lastActivityAt).toBeNull();

    // Mark a single in-progress turn on course A; the other learner should
    // remain at "not-started".
    await sendTurn({
      lessonId: (await prisma.lesson.findFirstOrThrow({ where: { slug: "a1" } })).id,
      learnerId: "iso-learner",
      content: "yes",
    });
    const b = await listCourses();
    const introB = b.find((c) => c.slug === "course-a")!;
    expect(introB.state).toBe("in-progress");
    expect(introB.completedCount).toBe(1);
    expect(introB.totalCount).toBe(2);
    expect(introB.lastActivityAt).not.toBeNull();

    // Switch to another learner — they should still see both as not-started.
    process.env.CURRENT_LEARNER_ID = "other-learner";
    const c = await listCourses();
    expect(c.every((course) => course.state === "not-started")).toBe(true);
  });

  it("refreshes course A's activity on every successful turn so Continue follows the most recent course", async () => {
    // Issue #17 reproduction: A activity, B activity, then another valid A
    // turn in an unfinished lesson. Continue must point at A after the
    // final turn — pickRecentActiveCourse and listCourses must agree.
    const { lessonsA, lessonsB } = await seedTwoCoursesInProgress();
    const learner = "activity-learner";
    process.env.CURRENT_LEARNER_ID = learner;

    const lessonA1 = lessonsA[0].id;
    const lessonB1 = lessonsB[0].id;

    await sendTurn({ lessonId: lessonA1, learnerId: learner, content: "yes" });
    await sendTurn({ lessonId: lessonB1, learnerId: learner, content: "yes" });
    const progressA = await prisma.progress.findUniqueOrThrow({
      where: { learnerId_lessonId: { learnerId: learner, lessonId: lessonA1 } },
    });
    const progressB = await prisma.progress.findUniqueOrThrow({
      where: { learnerId_lessonId: { learnerId: learner, lessonId: lessonB1 } },
    });
    expect(progressA.completed).toBe(false);
    expect(progressB.completed).toBe(false);

    const oldA = new Date("2026-01-01T00:00:00.000Z");
    const newerB = new Date("2026-01-01T00:01:00.000Z");
    await prisma.progress.update({
      where: { id: progressA.id },
      data: { updatedAt: oldA },
    });
    await prisma.progress.update({
      where: { id: progressB.id },
      data: { updatedAt: newerB },
    });
    let courses = await loadCoursesWithLessons(learner);
    expect(pickRecentActiveCourse(courses, learner)?.slug).toBe("course-b");

    await sendTurn({ lessonId: lessonA1, learnerId: learner, content: "go" });
    const progressAAfter = await prisma.progress.findUniqueOrThrow({
      where: { learnerId_lessonId: { learnerId: learner, lessonId: lessonA1 } },
    });
    expect(progressAAfter.completed).toBe(false);
    expect(progressAAfter.updatedAt.getTime()).toBeGreaterThan(newerB.getTime());

    courses = await loadCoursesWithLessons(learner);
    expect(pickRecentActiveCourse(courses, learner)?.slug).toBe("course-a");
    const summaries = await listCourses();
    const summaryAAfter = summaries.find((c) => c.slug === "course-a")!;
    const summaryBAfter = summaries.find((c) => c.slug === "course-b")!;
    expect(summaryAAfter.lastActivityAt! > summaryBAfter.lastActivityAt!).toBe(
      true,
    );

    const { getLearnerDashboard } = await import("@/lib/service");
    const dashboard = await getLearnerDashboard();
    expect(dashboard.continueCourseId).toBe(
      courses.find((c) => c.slug === "course-a")!.id,
    );
  });

  it("rejected turns do not touch activity (locked lesson, already-complete lesson, bad input)", async () => {
    const { lessonsA, lessonsB } = await seedTwoCoursesInProgress();
    const learner = "reject-learner";
    process.env.CURRENT_LEARNER_ID = learner;

    const lessonA1 = lessonsA[0].id;
    const lessonA2 = lessonsA[1].id;
    const lessonB1 = lessonsB[0].id;

    await sendTurn({ lessonId: lessonA1, learnerId: learner, content: "yes" });
    const aBefore = await prisma.progress.findUniqueOrThrow({
      where: { learnerId_lessonId: { learnerId: learner, lessonId: lessonA1 } },
    });
    const messageRoute = await import(
      "@/app/api/lessons/[lessonId]/messages/route"
    );
    const context = { params: Promise.resolve({ lessonId: lessonA1 }) };
    const badInput = await messageRoute.POST(
      new Request("http://localhost/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "" }),
      }),
      context,
    );
    expect(badInput.status).toBe(400);
    const aAfterBadInput = await prisma.progress.findUniqueOrThrow({
      where: { learnerId_lessonId: { learnerId: learner, lessonId: lessonA1 } },
    });
    expect(aAfterBadInput.updatedAt.getTime()).toBe(aBefore.updatedAt.getTime());

    await expect(
      sendTurn({ lessonId: lessonA2, learnerId: learner, content: "yes" }),
    ).rejects.toThrow();
    expect(
      await prisma.progress.findUnique({
        where: { learnerId_lessonId: { learnerId: learner, lessonId: lessonA2 } },
      }),
    ).toBeNull();

    await sendTurn({ lessonId: lessonB1, learnerId: learner, content: "yes" });
    await sendTurn({ lessonId: lessonB1, learnerId: learner, content: "go" });
    await sendTurn({ lessonId: lessonB1, learnerId: learner, content: "more" });
    const bBeforeRejectedTurn = await prisma.progress.findUniqueOrThrow({
      where: { learnerId_lessonId: { learnerId: learner, lessonId: lessonB1 } },
    });
    expect(bBeforeRejectedTurn.completed).toBe(true);
    await expect(
      sendTurn({ lessonId: lessonB1, learnerId: learner, content: "go" }),
    ).rejects.toThrow();
    const bAfterRejectedTurn = await prisma.progress.findUniqueOrThrow({
      where: { learnerId_lessonId: { learnerId: learner, lessonId: lessonB1 } },
    });
    expect(bAfterRejectedTurn.updatedAt.getTime()).toBe(
      bBeforeRejectedTurn.updatedAt.getTime(),
    );
  });
});

describe("seed script preserves learner state across a normal re-run", () => {
  // Invokes the real `prisma/seed.ts` against the test database. This is
  // exactly the script `npm run setup` runs on every `npm run dev` start,
  // so proving it preserves `Message` and `Progress` rows proves the
  // restart-persistence promise.
  function runRealSeed() {
    try {
      execSync("npx tsx prisma/seed.ts", {
        stdio: "pipe",
        env: { ...process.env, DATABASE_URL: "file:./test.db" },
      });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
      const out = (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
      throw new Error(
        `prisma seed failed (exit ${err.status ?? "?"}):\n${out}`,
      );
    }
  }

  it("keeps learner Message and Progress rows when the seed is re-run", async () => {
    runRealSeed();

    const lessonA = await prisma.lesson.findFirstOrThrow({
      where: { slug: "what-is-llm" },
    });
    const lessonB = await prisma.lesson.findFirstOrThrow({
      where: { slug: "role-and-audience" },
    });

    // Drive real learner turns on two different lessons so we own progress
    // rows and chat history for both seeded courses.
    await sendTurn({
      lessonId: lessonA.id,
      learnerId: "test-learner",
      content: "next",
    });
    await sendTurn({
      lessonId: lessonA.id,
      learnerId: "test-learner",
      content: "I have heard about them.",
    });
    await sendTurn({
      lessonId: lessonB.id,
      learnerId: "test-learner",
      content: "next",
    });

    const messagesBefore = await prisma.message.count();
    const progressBefore = await prisma.progress.count();
    expect(messagesBefore).toBeGreaterThan(0);
    expect(progressBefore).toBeGreaterThan(0);

    const tutorSample = await prisma.message.findFirstOrThrow({
      where: { lessonId: lessonA.id, role: "tutor" },
    });
    const learnerSample = await prisma.message.findFirstOrThrow({
      where: { lessonId: lessonA.id, role: "learner" },
    });

    // Re-run the real seed — this is what `npm run setup` does on every
    // `npm run dev` start, against a DB that already has learner state.
    runRealSeed();

    // Learner rows must survive.
    expect(await prisma.message.count()).toBe(messagesBefore);
    expect(await prisma.progress.count()).toBe(progressBefore);

    const tutorAfter = await prisma.message.findFirstOrThrow({
      where: { lessonId: lessonA.id, role: "tutor" },
    });
    const learnerAfter = await prisma.message.findFirstOrThrow({
      where: { lessonId: lessonA.id, role: "learner" },
    });
    expect(tutorAfter.id).toBe(tutorSample.id);
    expect(tutorAfter.content).toBe(tutorSample.content);
    expect(learnerAfter.id).toBe(learnerSample.id);
    expect(learnerAfter.content).toBe(learnerSample.content);

    // Progress for both lessons still belongs to this learner.
    const progressA = await prisma.progress.findUniqueOrThrow({
      where: {
        learnerId_lessonId: { learnerId: "test-learner", lessonId: lessonA.id },
      },
    });
    const progressB = await prisma.progress.findUniqueOrThrow({
      where: {
        learnerId_lessonId: { learnerId: "test-learner", lessonId: lessonB.id },
      },
    });
    expect(progressA.completed).toBe(false);
    expect(progressB.completed).toBe(false);
  });

  it("is idempotent on seeded courses and lessons across a re-run", async () => {
    runRealSeed();
    const coursesBefore = await prisma.course.count();
    const lessonsBefore = await prisma.lesson.count();
    expect(coursesBefore).toBe(2);
    expect(lessonsBefore).toBe(6);

    runRealSeed();

    expect(await prisma.course.count()).toBe(coursesBefore);
    expect(await prisma.lesson.count()).toBe(lessonsBefore);
  });

  it("preserves legacy Message rows (no learnerId) under demo-learner across the real upgrade", async () => {
    // Build the pre-#21 schema shape: a Message table without learnerId and
    // a transcript that was created before learner ownership existed.
    // Then run the real upgrade (backfill -> db push -> seed) and prove the
    // legacy ids and contents survive intact under demo-learner.
    runRealSeed();
    const seededLesson = await prisma.lesson.findFirstOrThrow({
      where: { slug: "what-is-llm" },
    });

    // Synthesise the pre-#21 shape: drop learnerId from the schema by
    // recreating Message in its old form, then insert verbatim the legacy
    // transcript we want to survive the upgrade. This mirrors what a real
    // pre-upgrade DB looks like on disk.
    const legacyRows = [
      {
        id: "legacy-tutor-1",
        lessonId: seededLesson.id,
        role: "tutor",
        content: "Welcome — legacy transcript opener.",
        createdAt: new Date("2026-01-01T10:00:00.000Z"),
      },
      {
        id: "legacy-learner-1",
        lessonId: seededLesson.id,
        role: "learner",
        content: "legacy learner turn",
        createdAt: new Date("2026-01-01T10:00:05.000Z"),
      },
      {
        id: "legacy-tutor-2",
        lessonId: seededLesson.id,
        role: "tutor",
        content: "Legacy follow-up tutor line.",
        createdAt: new Date("2026-01-01T10:00:10.000Z"),
      },
    ];
    const legacyIds = legacyRows.map((r) => r.id);
    const legacyContents = legacyRows.map((r) => r.content);

    await prisma.$transaction([
      prisma.message.deleteMany({ where: { lessonId: seededLesson.id } }),
      prisma.$executeRawUnsafe("DROP TABLE Message"),
      prisma.$executeRawUnsafe(
        "CREATE TABLE Message (id TEXT PRIMARY KEY, lessonId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP), FOREIGN KEY (lessonId) REFERENCES Lesson(id) ON DELETE CASCADE)",
      ),
    ]);
    for (const r of legacyRows) {
      await prisma.$executeRawUnsafe(
        "INSERT INTO Message (id, lessonId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)",
        r.id,
        r.lessonId,
        r.role,
        r.content,
        r.createdAt.toISOString(),
      );
    }

    function runBackfill() {
      try {
        execSync("node scripts/backfill-learner-ownership.mjs", {
          stdio: "pipe",
          env: { ...process.env, DATABASE_URL: "file:./test.db" },
        });
      } catch (e) {
        const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
        const out =
          (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
        throw new Error(`backfill failed (exit ${err.status ?? "?"}):\n${out}`);
      }
    }
    function runDbPush() {
      try {
        execSync("npx prisma db push --skip-generate --accept-data-loss", {
          stdio: "pipe",
          env: { ...process.env, DATABASE_URL: "file:./test.db" },
        });
      } catch (e) {
        const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
        const out =
          (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
        throw new Error(`prisma db push failed (exit ${err.status ?? "?"}):\n${out}`);
      }
    }

    runBackfill();
    runDbPush();

    // Every legacy id and its content must still be present, and every
    // legacy row is now owned by demo-learner.
    const upgraded = await prisma.message.findMany({
      where: { lessonId: seededLesson.id },
      orderBy: { createdAt: "asc" },
    });
    expect(upgraded.map((m) => m.id)).toEqual(legacyIds);
    expect(upgraded.map((m) => m.content)).toEqual(legacyContents);
    for (const m of upgraded) {
      expect(m.learnerId).toBe("demo-learner");
    }

    // The temporary legacy default must not survive the schema sync. New
    // writers must provide an owner instead of silently becoming demo data.
    const messageColumns = await prisma.$queryRawUnsafe<
      Array<{ name: string; notnull: bigint; dflt_value: string | null }>
    >("PRAGMA table_info(Message)");
    const learnerColumn = messageColumns.find((column) => column.name === "learnerId");
    expect(learnerColumn?.notnull).toBe(1n);
    expect(learnerColumn?.dflt_value).toBeNull();

    // The backfill must be idempotent on a second run — running it again
    // must not drop, rename, or rewrite any rows.
    runBackfill();
    const reread = await prisma.message.findMany({
      where: { lessonId: seededLesson.id },
      orderBy: { createdAt: "asc" },
    });
    expect(reread.map((m) => m.id)).toEqual(legacyIds);
    for (const m of reread) expect(m.learnerId).toBe("demo-learner");

    // This test mutates the schema shape (DROP TABLE + CREATE without
    // learnerId). Restore the modern Message table so subsequent tests in
    // the suite can run against the expected schema.
    runDbPush();
  });

  it("keeps Message and Progress ownership intact across a normal setup re-run", async () => {
    runRealSeed();
    const lessonA = await prisma.lesson.findFirstOrThrow({
      where: { slug: "what-is-llm" },
    });

    // Drive one real learner turn so a transcript exists with owner.
    await sendTurn({
      lessonId: lessonA.id,
      learnerId: "test-learner",
      content: "next",
    });

    const before = await prisma.message.findMany({
      where: { lessonId: lessonA.id, learnerId: "test-learner" },
      orderBy: { createdAt: "asc" },
    });
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((m) => m.learnerId === "test-learner")).toBe(true);

    // Run setup again. This is what `npm run dev` does on every restart.
    runRealSeed();

    const after = await prisma.message.findMany({
      where: { lessonId: lessonA.id, learnerId: "test-learner" },
      orderBy: { createdAt: "asc" },
    });
    expect(after.length).toBe(before.length);
    expect(after.map((m) => m.id)).toEqual(before.map((m) => m.id));
    expect(after.every((m) => m.learnerId === "test-learner")).toBe(true);
  });
});

describe("learner-owned messages — isolation & per-learner seed", () => {
  // Issue #21: two learners on the same lesson must see separate
  // transcripts; neither learner's reads/writes may touch the other's
  // rows; concurrent seed calls from each learner must each get their own
  // opening row.

  beforeEach(async () => {
    // Re-bind module handles per the existing pattern.
    const dbMod = await import("@/lib/db");
    await dbMod.prisma.$disconnect();
    const svc = await import("@/lib/service");
    prisma = dbMod.prisma;
    sendTurn = svc.sendTurn;

    await prisma.message.deleteMany();
    await prisma.progress.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.course.deleteMany();
  });

  async function seedLesson() {
    const course = await prisma.course.create({
      data: { slug: "iso", title: "Iso", description: "d" },
    });
    const lesson = await prisma.lesson.create({
      data: {
        courseId: course.id,
        slug: "iso-1",
        title: "Iso 1",
        order: 1,
        script: JSON.stringify([
          { kind: "tutor", content: "Opening line." },
          { kind: "learner", prompt: "ready", expect: ["yes", "ready"] },
          { kind: "tutor", content: "Advance line." },
          { kind: "learner", prompt: "more", expect: ["go", "next"] },
          { kind: "tutor", content: "Still in progress." },
        ]),
      },
    });
    return { course, lesson };
  }

  it("two learners get separate transcripts on the same lesson and never see each other's messages", async () => {
    const { lesson } = await seedLesson();
    const learnerA = "learner-a";
    const learnerB = "learner-b";

    // Learner A sends a turn; learner B sends a different turn.
    const aTurn = await sendTurn({
      lessonId: lesson.id,
      learnerId: learnerA,
      content: "yes from A",
    });
    const bTurn = await sendTurn({
      lessonId: lesson.id,
      learnerId: learnerB,
      content: "yes from B",
    });
    expect(aTurn.isComplete).toBe(false);
    expect(bTurn.isComplete).toBe(false);

    // Both learners have a 3-row transcript (opening + learner + advance).
    const aMessages = await prisma.message.findMany({
      where: { lessonId: lesson.id, learnerId: learnerA },
      orderBy: { createdAt: "asc" },
    });
    const bMessages = await prisma.message.findMany({
      where: { lessonId: lesson.id, learnerId: learnerB },
      orderBy: { createdAt: "asc" },
    });
    expect(aMessages.map((m) => m.role)).toEqual(["tutor", "learner", "tutor"]);
    expect(bMessages.map((m) => m.role)).toEqual(["tutor", "learner", "tutor"]);
    expect(aMessages[1].content).toBe("yes from A");
    expect(bMessages[1].content).toBe("yes from B");
    // The two transcripts share no row ids.
    expect(aMessages.map((m) => m.id)).not.toEqual(bMessages.map((m) => m.id));

    // `getLessonWithMessages` must filter by the active learner: with no
    // env override it returns the test-learner identity, but for the
    // assertion we read through the service path that uses
    // getCurrentLearnerId — flip CURRENT_LEARNER_ID to confirm scoping.
    process.env.CURRENT_LEARNER_ID = learnerA;
    const viewA = (await import("@/lib/service")).getLessonWithMessages(
      lesson.id,
    );
    expect((await viewA)?.messages.map((m) => m.content)).toEqual([
      "Opening line.",
      "yes from A",
      "Advance line.",
    ]);
    process.env.CURRENT_LEARNER_ID = learnerB;
    const viewB = (await import("@/lib/service")).getLessonWithMessages(
      lesson.id,
    );
    expect((await viewB)?.messages.map((m) => m.content)).toEqual([
      "Opening line.",
      "yes from B",
      "Advance line.",
    ]);

    // Neither learner has touched the other's Progress rows.
    const progressA = await prisma.progress.findUnique({
      where: { learnerId_lessonId: { learnerId: learnerA, lessonId: lesson.id } },
    });
    const progressB = await prisma.progress.findUnique({
      where: { learnerId_lessonId: { learnerId: learnerB, lessonId: lesson.id } },
    });
    expect(progressA?.learnerId).toBe(learnerA);
    expect(progressB?.learnerId).toBe(learnerB);
    expect(progressA?.id).not.toBe(progressB?.id);
  });

  it("concurrent seed calls from two learners each create their own opening row, exactly once each", async () => {
    const { lesson } = await seedLesson();
    const learnerA = "learner-a";
    const learnerB = "learner-b";
    const { POST } = await import("@/app/api/lessons/[lessonId]/seed/route");

    process.env.CURRENT_LEARNER_ID = learnerA;
    const ctxA = { params: Promise.resolve({ lessonId: lesson.id }) };
    process.env.CURRENT_LEARNER_ID = learnerB;
    const ctxB = { params: Promise.resolve({ lessonId: lesson.id }) };

    // Drive two concurrent seed calls from each learner; per-learner
    // upsert idempotency must keep the total row count at 2 (one per
    // learner) even with Strict Mode-style retries.
    process.env.CURRENT_LEARNER_ID = learnerA;
    const [a1, a2] = await Promise.all([
      POST(new Request("http://localhost/seed", { method: "POST" }), ctxA),
      POST(new Request("http://localhost/seed", { method: "POST" }), ctxA),
    ]);
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(200);

    process.env.CURRENT_LEARNER_ID = learnerB;
    const [b1, b2] = await Promise.all([
      POST(new Request("http://localhost/seed", { method: "POST" }), ctxB),
      POST(new Request("http://localhost/seed", { method: "POST" }), ctxB),
    ]);
    expect(b1.status).toBe(200);
    expect(b2.status).toBe(200);

    const totalMessages = await prisma.message.count({
      where: { lessonId: lesson.id },
    });
    expect(totalMessages).toBe(2);
    const ownerIds = (
      await prisma.message.findMany({
        where: { lessonId: lesson.id },
        select: { learnerId: true },
      })
    ).map((m) => m.learnerId);
    expect(ownerIds.sort()).toEqual([learnerA, learnerB].sort());

    // Each learner's progress row was created on their seed.
    const progressA = await prisma.progress.findUniqueOrThrow({
      where: { learnerId_lessonId: { learnerId: learnerA, lessonId: lesson.id } },
    });
    const progressB = await prisma.progress.findUniqueOrThrow({
      where: { learnerId_lessonId: { learnerId: learnerB, lessonId: lesson.id } },
    });
    expect(progressA.learnerId).toBe(learnerA);
    expect(progressB.learnerId).toBe(learnerB);
  });
});

describe("auth + identity isolation (issue #23)", () => {
  // Issue #23: cookie-based auth composes with the existing per-learner
  // isolation invariant. Registering two learners, logging in as A,
  // completing a lesson, logging out, and logging in as B must produce
  // B with an empty transcript and no progress on that lesson.

  beforeEach(async () => {
    const dbMod = await import("@/lib/db");
    await dbMod.prisma.$disconnect();
    const svc = await import("@/lib/service");
    prisma = dbMod.prisma;
    sendTurn = svc.sendTurn;

    await prisma.learner.deleteMany();
    await prisma.message.deleteMany();
    await prisma.progress.deleteMany();
    await prisma.lesson.deleteMany();
    await prisma.course.deleteMany();
  });

  async function seedOneLesson() {
    const course = await prisma.course.create({
      data: { slug: "iso-course", title: "Iso", description: "iso" },
    });
    const lesson = await prisma.lesson.create({
      data: {
        courseId: course.id,
        slug: "iso-1",
        title: "Iso 1",
        order: 1,
        script: JSON.stringify([
          { kind: "tutor", content: "Hi there." },
          { kind: "learner", prompt: "ready", expect: ["yes", "ok"] },
          { kind: "tutor", content: "Great." },
          { kind: "learner", prompt: "done", expect: ["done"] },
          { kind: "tutor", content: "Lesson complete." },
        ]),
      },
    });
    return { course, lesson };
  }

  it("register A → log in A → drive a turn → log out → log in B → A's transcript + progress invisible to B", async () => {
    const { lesson } = await seedOneLesson();

    // Register two learners via the real route handler.
    const registerPOST = (await import("@/app/api/auth/register/route")).POST;
    const loginPOST = (await import("@/app/api/auth/login/route")).POST;
    const logoutPOST = (await import("@/app/api/auth/logout/route")).POST;
    const meGET = (await import("@/app/api/auth/me/route")).GET;

    function json(body: unknown) {
      return {
        method: "POST" as const,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      };
    }

    const regA = await registerPOST(
      new Request("http://localhost/register", json({
        email: "alice@tdr.test",
        password: "hunter22-correcthorse",
      })),
    );
    expect(regA.status).toBe(200);
    const learnerA = ((await regA.json()) as { id: string }).id;

    const regB = await registerPOST(
      new Request("http://localhost/register", json({
        email: "bob@tdr.test",
        password: "hunter22-correcthorse",
      })),
    );
    expect(regB.status).toBe(200);
    const learnerB = ((await regB.json()) as { id: string }).id;
    expect(learnerB).not.toBe(learnerA);

    // Log in as A and drive a turn via the service layer using the real
    // learner id (cookies() throws outside of a request scope here, so we
    // reach into the service directly with the registered id).
    const loginA = await loginPOST(
      new Request("http://localhost/login", json({
        email: "alice@tdr.test",
        password: "hunter22-correcthorse",
      })),
    );
    expect(loginA.status).toBe(200);
    const cookieA = loginA.headers.get("set-cookie")!;
    const m = cookieA.match(/tdr_session=([^;]+)/);
    expect(m).not.toBeNull();

    const meA = await meGET(
      new Request("http://localhost/me", {
        headers: { cookie: `tdr_session=${m![1]}` },
      }),
    );
    const meABody = (await meA.json()) as { learner: { id: string } | null };
    expect(meABody.learner?.id).toBe(learnerA);

    await sendTurn({
      lessonId: lesson.id,
      learnerId: learnerA,
      content: "yes",
    });

    // A has a real transcript and progress row.
    const aMessagesBefore = await prisma.message.findMany({
      where: { lessonId: lesson.id, learnerId: learnerA },
      orderBy: { createdAt: "asc" },
    });
    expect(aMessagesBefore.map((m) => m.role)).toEqual(["tutor", "learner", "tutor"]);
    const aProgressBefore = await prisma.progress.findUnique({
      where: { learnerId_lessonId: { learnerId: learnerA, lessonId: lesson.id } },
    });
    expect(aProgressBefore?.completed).toBe(false);

    // B has nothing on it.
    const bMessagesBefore = await prisma.message.findMany({
      where: { lessonId: lesson.id, learnerId: learnerB },
    });
    expect(bMessagesBefore).toEqual([]);
    const bProgressBefore = await prisma.progress.findUnique({
      where: { learnerId_lessonId: { learnerId: learnerB, lessonId: lesson.id } },
    });
    expect(bProgressBefore).toBeNull();

    // Log A out (cookie clear).
    const logout = await logoutPOST();
    expect(logout.status).toBe(200);

    // Log in as B; the new cookie must resolve to B.
    const loginB = await loginPOST(
      new Request("http://localhost/login", json({
        email: "bob@tdr.test",
        password: "hunter22-correcthorse",
      })),
    );
    expect(loginB.status).toBe(200);
    const cookieB = loginB.headers.get("set-cookie")!;
    const mb = cookieB.match(/tdr_session=([^;]+)/);
    expect(mb).not.toBeNull();
    const meB = await meGET(
      new Request("http://localhost/me", {
        headers: { cookie: `tdr_session=${mb![1]}` },
      }),
    );
    const meBBody = (await meB.json()) as { learner: { id: string } | null };
    expect(meBBody.learner?.id).toBe(learnerB);

    // Login round-trip assertion: re-login the same A and confirm the new
    // cookie subject matches the original learner id.
    const reLoginA = await loginPOST(
      new Request("http://localhost/login", json({
        email: "alice@tdr.test",
        password: "hunter22-correcthorse",
      })),
    );
    expect(reLoginA.status).toBe(200);
    const cookieRA = reLoginA.headers.get("set-cookie")!;
    const mra = cookieRA.match(/tdr_session=([^;]+)/);
    const meRA = await meGET(
      new Request("http://localhost/me", {
        headers: { cookie: `tdr_session=${mra![1]}` },
      }),
    );
    const meRABody = (await meRA.json()) as { learner: { id: string } | null };
    expect(meRABody.learner?.id).toBe(learnerA);

    // A's transcript and progress are unchanged across both logins.
    const aMessagesAfter = await prisma.message.findMany({
      where: { lessonId: lesson.id, learnerId: learnerA },
      orderBy: { createdAt: "asc" },
    });
    expect(aMessagesAfter.map((m) => m.id)).toEqual(aMessagesBefore.map((m) => m.id));
    const aProgressAfter = await prisma.progress.findUnique({
      where: { learnerId_lessonId: { learnerId: learnerA, lessonId: lesson.id } },
    });
    expect(aProgressAfter?.id).toBe(aProgressBefore?.id);
  });
});
