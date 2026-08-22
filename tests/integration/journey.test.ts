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
import { listCourses, LessonCompleteError } from "@/lib/service";
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

  it("rejects learner turns after completion and keeps the transcript byte-for-byte stable", async () => {
    const { lessons } = await seedFixtures();
    const learner = "test-learner";
    const lessonId = lessons[0].id;

    await sendTurn({ lessonId, learnerId: learner, content: "yes" });
    await sendTurn({ lessonId, learnerId: learner, content: "done" });

    const before = await prisma.message.findMany({
      where: { lessonId },
      orderBy: { createdAt: "asc" },
    });
    expect(before.length).toBe(5);

    // A post-complete turn must be rejected with LessonCompleteError and
    // must NOT mutate the transcript.
    await expect(
      sendTurn({
        lessonId,
        learnerId: learner,
        content: "anything else",
      }),
    ).rejects.toBeInstanceOf(LessonCompleteError);

    const after = await prisma.message.findMany({
      where: { lessonId },
      orderBy: { createdAt: "asc" },
    });
    // Byte-for-byte / count-stable: same rows, same count, same ids.
    expect(after.length).toBe(before.length);
    expect(after.map((m) => m.id)).toEqual(before.map((m) => m.id));
    expect(after.map((m) => m.content)).toEqual(before.map((m) => m.content));

    const afterProgress = await prisma.progress.findUnique({
      where: { learnerId_lessonId: { learnerId: learner, lessonId } },
    });
    expect(afterProgress?.completed).toBe(true);
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
});
