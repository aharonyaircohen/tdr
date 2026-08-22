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
} from "@/lib/progress";
import { listCourses } from "@/lib/service";

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

    // Complete course A's first lesson.
    await sendTurn({ lessonId: lessonsA[0].id, learnerId: learner, content: "yes" });
    await sendTurn({ lessonId: lessonsA[0].id, learnerId: learner, content: "ok" });
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
    await sendTurn({ lessonId: lessonsA[0].id, learnerId: learner, content: "ok" });

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
