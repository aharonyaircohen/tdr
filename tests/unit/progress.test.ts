import { describe, it, expect } from "vitest";
import {
  pickResumeLesson,
  canEnterLesson,
  isLessonComplete,
  summariseProgress,
  summariseCourseProgress,
  pickRecentActiveCourse,
} from "@/lib/progress";
import type { Course, Lesson, Progress } from "@prisma/client";

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

function makeProgress(
  learnerId: string,
  lessonId: string,
  completed: boolean,
  updatedAt: Date = new Date(),
): Progress {
  return {
    id: `${learnerId}-${lessonId}`,
    learnerId,
    lessonId,
    completed,
    updatedAt,
  };
}

function makeCourse(over: Partial<Course>): Course {
  return {
    id: over.id ?? "course",
    slug: over.slug ?? "course",
    title: over.title ?? "Course",
    description: over.description ?? "desc",
    createdAt: over.createdAt ?? new Date(),
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

describe("summariseCourseProgress", () => {
  const learner = "u1";
  const lessons = [
    { ...makeLesson({ id: "l1", order: 1 }), progress: [] },
    { ...makeLesson({ id: "l2", order: 2 }), progress: [] },
    { ...makeLesson({ id: "l3", order: 3 }), progress: [] },
  ];
  const course = {
    ...makeCourse({ id: "c1", slug: "intro", title: "Intro" }),
    lessons,
  };

  it("reports not-started when there is no progress", () => {
    const out = summariseCourseProgress(course, learner);
    expect(out.state).toBe("not-started");
    expect(out.completed).toBe(0);
    expect(out.total).toBe(3);
    expect(out.lastActivityAt).toBeNull();
  });

  it("reports complete when every lesson is finished", () => {
    const done = {
      ...course,
      lessons: lessons.map((l) => ({
        ...l,
        progress: [makeProgress(learner, l.id, true)],
      })),
    };
    const out = summariseCourseProgress(done, learner);
    expect(out.state).toBe("complete");
    expect(out.completed).toBe(3);
    expect(out.total).toBe(3);
    expect(out.lastActivityAt).not.toBeNull();
  });

  it("reports in-progress when at least one lesson is incomplete", () => {
    const partial = {
      ...course,
      lessons: lessons.map((l, i) => ({
        ...l,
        progress:
          i === 0
            ? [makeProgress(learner, l.id, true, new Date("2026-01-01"))]
            : i === 1
              ? [makeProgress(learner, l.id, false, new Date("2026-02-01"))]
              : [],
      })),
    };
    const out = summariseCourseProgress(partial, learner);
    expect(out.state).toBe("in-progress");
    expect(out.completed).toBe(1);
    expect(out.total).toBe(3);
    expect(out.lastActivityAt?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("ignores progress rows from other learners when computing state", () => {
    const mixed = {
      ...course,
      lessons: lessons.map((l) => ({
        ...l,
        progress: [makeProgress("someone-else", l.id, true)],
      })),
    };
    const out = summariseCourseProgress(mixed, learner);
    expect(out.state).toBe("not-started");
  });
});

describe("pickRecentActiveCourse", () => {
  const learner = "u1";

  function buildCourse(id: string, lessonProgress: Progress[][]) {
    const lessons = lessonProgress.map((rows, i) => ({
      ...makeLesson({ id: `${id}-l${i + 1}`, courseId: id, order: i + 1 }),
      progress: rows,
    }));
    return { ...makeCourse({ id, slug: id, title: id }), lessons };
  }

  it("returns null when no course has progress", () => {
    const a = buildCourse("a", [[], [], []]);
    const b = buildCourse("b", [[], [], []]);
    expect(pickRecentActiveCourse([a, b], learner)).toBeNull();
  });

  it("returns the only course with an unfinished lesson", () => {
    const a = buildCourse("a", [
      [makeProgress(learner, "a-l1", true, new Date("2026-01-01"))],
      [],
      [],
    ]);
    const b = buildCourse("b", [
      [makeProgress(learner, "b-l1", false, new Date("2026-02-01"))],
      [],
      [],
    ]);
    expect(pickRecentActiveCourse([a, b], learner)?.id).toBe("b");
  });

  it("does not let a completed course displace an unfinished one", () => {
    // Course A completed very recently; course B was touched earlier but is
    // still unfinished. The Continue card must surface B.
    const a = buildCourse("a", [
      [makeProgress(learner, "a-l1", true, new Date("2026-03-01"))],
      [makeProgress(learner, "a-l2", true, new Date("2026-03-02"))],
      [makeProgress(learner, "a-l3", true, new Date("2026-03-03"))],
    ]);
    const b = buildCourse("b", [
      [makeProgress(learner, "b-l1", true, new Date("2026-02-01"))],
      [makeProgress(learner, "b-l2", false, new Date("2026-02-02"))],
      [],
    ]);
    expect(pickRecentActiveCourse([a, b], learner)?.id).toBe("b");
  });

  it("picks the most recently active unfinished course", () => {
    const a = buildCourse("a", [
      [makeProgress(learner, "a-l1", true, new Date("2026-01-01"))],
      [makeProgress(learner, "a-l2", false, new Date("2026-01-02"))],
      [],
    ]);
    const b = buildCourse("b", [
      [makeProgress(learner, "b-l1", true, new Date("2026-02-01"))],
      [makeProgress(learner, "b-l2", false, new Date("2026-02-05"))],
      [],
    ]);
    expect(pickRecentActiveCourse([a, b], learner)?.id).toBe("b");
  });

  it("ignores progress from other learners", () => {
    const a = buildCourse("a", [
      [makeProgress("someone-else", "a-l1", false, new Date("2026-04-01"))],
      [],
      [],
    ]);
    expect(pickRecentActiveCourse([a], learner)).toBeNull();
  });

  it("returns null when every course is complete", () => {
    const a = buildCourse("a", [
      [makeProgress(learner, "a-l1", true, new Date("2026-01-01"))],
      [makeProgress(learner, "a-l2", true, new Date("2026-01-02"))],
      [],
    ]);
    const b = buildCourse("b", [
      [makeProgress(learner, "b-l1", true, new Date("2026-02-01"))],
      [],
      [],
    ]);
    expect(pickRecentActiveCourse([a, b], learner)).toBeNull();
  });
});