// Progress + resume logic. Pure functions over Prisma model arrays so they can
// be unit-tested without a DB.

import type { Course, Lesson, Message, Progress } from "@prisma/client";

export type LessonWithProgress = Lesson & { progress: Progress[] };
export type CourseWithLessons = Course & { lessons: LessonWithProgress[] };

/**
 * Pick the next lesson for a learner given the course's lessons and the
 * learner's progress records.
 *
 * Rule: first lesson (by `order`) that has no Progress row OR whose
 * `completed` is false. If all are complete, return the last lesson.
 */
export function pickResumeLesson(
  lessons: LessonWithProgress[],
  learnerId: string,
): LessonWithProgress | null {
  if (lessons.length === 0) return null;
  const sorted = [...lessons].sort((a, b) => a.order - b.order);
  for (const lesson of sorted) {
    const p = lesson.progress.find((row) => row.learnerId === learnerId);
    if (!p || !p.completed) {
      return lesson;
    }
  }
  return sorted[sorted.length - 1];
}

/**
 * Is the learner allowed to start lesson `target` given their progress on
 * earlier lessons? They must have completed every lesson with a lower order.
 * Used to gate forward navigation without breaking the "current lesson"
 * resume flow.
 */
export function canEnterLesson(
  lessons: LessonWithProgress[],
  learnerId: string,
  targetLessonId: string,
): boolean {
  const sorted = [...lessons].sort((a, b) => a.order - b.order);
  const target = sorted.find((l) => l.id === targetLessonId);
  if (!target) return false;
  for (const lesson of sorted) {
    if (lesson.order >= target.order) return true;
    const p = lesson.progress.find((row) => row.learnerId === learnerId);
    if (!p || !p.completed) return false;
  }
  return true;
}

export function isLessonComplete(
  lesson: LessonWithProgress,
  learnerId: string,
): boolean {
  return Boolean(
    lesson.progress.find((row) => row.learnerId === learnerId && row.completed),
  );
}

export function summariseProgress(
  lessons: LessonWithProgress[],
  learnerId: string,
): { completed: number; total: number } {
  const total = lessons.length;
  const completed = lessons.filter((l) => isLessonComplete(l, learnerId)).length;
  return { completed, total };
}

export type CourseProgressState = "not-started" | "in-progress" | "complete";

/**
 * Per-course progress summary. Returned in the catalog and used by the
 * home dashboard to render the per-card state badge and progress count.
 *
 * State rules:
 *   - "not-started": no Progress rows exist for this learner.
 *   - "complete":    every lesson has a completed Progress row.
 *   - "in-progress": at least one Progress row exists and at least one
 *                    lesson is not yet completed.
 */
export function summariseCourseProgress(
  course: CourseWithLessons,
  learnerId: string,
): {
  state: CourseProgressState;
  completed: number;
  total: number;
  lastActivityAt: Date | null;
} {
  const total = course.lessons.length;
  const completed = course.lessons.filter((l) =>
    isLessonComplete(l, learnerId),
  ).length;
  let lastActivityAt: Date | null = null;
  let hasAnyProgress = false;
  for (const lesson of course.lessons) {
    for (const row of lesson.progress) {
      if (row.learnerId !== learnerId) continue;
      hasAnyProgress = true;
      if (!lastActivityAt || row.updatedAt > lastActivityAt) {
        lastActivityAt = row.updatedAt;
      }
    }
  }
  let state: CourseProgressState;
  if (!hasAnyProgress) state = "not-started";
  else if (completed === total) state = "complete";
  else state = "in-progress";
  return { state, completed, total, lastActivityAt };
}

/**
 * Pick the course the learner should be nudged to continue, given all of
 * the catalog's courses plus the learner's progress on each.
 *
 * Rules:
 *   - Only courses with at least one Progress row with `completed: false`
 *     are candidates ("unfinished, has activity").
 *   - Among the candidates, the one whose latest `updatedAt` is the most
 *     recent wins.
 *   - If no course qualifies, return null so the UI can hide the
 *     Continue learning card.
 *
 * A course whose every lesson is completed MUST NOT displace an unfinished
 * course — even if its activity is more recent. This is what callers
 * rely on to surface the in-progress course ahead of a finished one.
 */
export function pickRecentActiveCourse(
  courses: CourseWithLessons[],
  learnerId: string,
): CourseWithLessons | null {
  let best: CourseWithLessons | null = null;
  let bestAt: Date | null = null;
  for (const course of courses) {
    const summary = summariseCourseProgress(course, learnerId);
    if (summary.state !== "in-progress") continue;
    if (!summary.lastActivityAt) continue;
    if (!bestAt || summary.lastActivityAt > bestAt) {
      best = course;
      bestAt = summary.lastActivityAt;
    }
  }
  return best;
}

export type LessonMessages = Pick<Message, "id" | "role" | "content" | "createdAt">[];