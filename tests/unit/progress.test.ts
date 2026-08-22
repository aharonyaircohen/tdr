import { describe, it, expect } from "vitest";
import {
  pickResumeLesson,
  canEnterLesson,
  isLessonComplete,
  summariseProgress,
} from "@/lib/progress";
import type { Lesson, Progress } from "@prisma/client";

function makeLesson(over: Partial<Lesson>): Lesson {
  return {
    id: over.id ?? "lesson",
    courseId: over.courseId ?? "course",
    slug: over.slug ?? "slug",
    title: over.title ?? "title",
    order: over.order ?? 1,
    script: over.script ?? "[]",
    createdAt: over.createdAt ?? new Date(),
  };
}

function makeProgress(learnerId: string, lessonId: string, completed: boolean): Progress {
  return {
    id: `${learnerId}-${lessonId}`,
    learnerId,
    lessonId,
    completed,
    updatedAt: new Date(),
  };
}

describe("pickResumeLesson", () => {
  const learner = "u1";
  const lessons = [
    { ...makeLesson({ id: "l1", order: 1 }), progress: [] },
    { ...makeLesson({ id: "l2", order: 2 }), progress: [] },
    { ...makeLesson({ id: "l3", order: 3 }), progress: [] },
  ];

  it("returns the first lesson when there is no progress at all", () => {
    expect(pickResumeLesson(lessons, learner)?.id).toBe("l1");
  });

  it("skips completed lessons and returns the next unfinished one", () => {
    const withProgress = lessons.map((l, i) => ({
      ...l,
      progress: i < 1 ? [makeProgress(learner, l.id, true)] : [],
    }));
    expect(pickResumeLesson(withProgress, learner)?.id).toBe("l2");
  });

  it("returns the last lesson once everything is complete", () => {
    const allDone = lessons.map((l) => ({
      ...l,
      progress: [makeProgress(learner, l.id, true)],
    }));
    expect(pickResumeLesson(allDone, learner)?.id).toBe("l3");
  });

  it("does not consider other learners' progress", () => {
    const mixed = lessons.map((l, i) => ({
      ...l,
      progress:
        i < 2 ? [makeProgress("someone-else", l.id, true)] : [],
    }));
    expect(pickResumeLesson(mixed, learner)?.id).toBe("l1");
  });

  it("returns null when there are no lessons", () => {
    expect(pickResumeLesson([], learner)).toBeNull();
  });
});

describe("canEnterLesson", () => {
  const learner = "u1";
  const lessons = [
    { ...makeLesson({ id: "l1", order: 1 }), progress: [] },
    { ...makeLesson({ id: "l2", order: 2 }), progress: [] },
    { ...makeLesson({ id: "l3", order: 3 }), progress: [] },
  ];

  it("lets the learner enter lesson 1 with no prior progress", () => {
    expect(canEnterLesson(lessons, learner, "l1")).toBe(true);
  });

  it("blocks entry to lesson 3 when lesson 1 is incomplete", () => {
    expect(canEnterLesson(lessons, learner, "l3")).toBe(false);
  });

  it("allows entry to lesson 3 once lesson 1 and 2 are complete", () => {
    const withProgress = lessons.map((l, i) => ({
      ...l,
      progress: i < 2 ? [makeProgress(learner, l.id, true)] : [],
    }));
    expect(canEnterLesson(withProgress, learner, "l3")).toBe(true);
  });

  it("returns false for an unknown lesson id", () => {
    expect(canEnterLesson(lessons, learner, "nope")).toBe(false);
  });
});

describe("isLessonComplete + summariseProgress", () => {
  const learner = "u1";
  const lessons = [
    { ...makeLesson({ id: "l1", order: 1 }), progress: [] },
    { ...makeLesson({ id: "l2", order: 2 }), progress: [] },
  ];

  it("reports the lesson complete only when this learner has a completed row", () => {
    const withProgress = lessons.map((l) => ({
      ...l,
      progress: [makeProgress(learner, l.id, true)],
    }));
    expect(isLessonComplete(withProgress[0], learner)).toBe(true);
    expect(isLessonComplete(withProgress[1], learner)).toBe(true);
  });

  it("summarises correctly with mixed progress", () => {
    const withProgress = lessons.map((l, i) => ({
      ...l,
      progress: i === 0 ? [makeProgress(learner, l.id, true)] : [],
    }));
    expect(summariseProgress(withProgress, learner)).toEqual({
      completed: 1,
      total: 2,
    });
  });
});