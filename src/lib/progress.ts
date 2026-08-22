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

export type LessonMessages = Pick<Message, "id" | "role" | "content" | "createdAt">[];