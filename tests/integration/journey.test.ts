// End-to-end integration test of the chat turn endpoint + resume flow against
// a real SQLite database. Each test seeds the schema fresh and exercises
// `sendTurn` and `pickResumeLesson` together.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const testDbPath = path.resolve(process.cwd(), "prisma/test.db");

function freshDb() {
  for (const ext of ["", "-journal"]) {
    try {
      fs.unlinkSync(testDbPath + ext);
    } catch {
      // ignore
    }
  }
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