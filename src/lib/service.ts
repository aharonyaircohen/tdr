// Service layer: combines db + chat engine + progress logic.
// This is the only place that writes to the DB from a request, which keeps
// route handlers thin and the chat turn logic testable.

import { prisma } from "./db";
import {
  ConversationTurn,
  parseScript,
  selectTutorReply,
} from "./script";
import { getCurrentLearnerId } from "./learner";
import {
  pickResumeLesson,
  pickRecentActiveCourse,
  canEnterLesson,
  summariseCourseProgress,
  CourseProgressState,
} from "./progress";
import { Prisma } from "@prisma/client";

export type CourseSummary = {
  id: string;
  slug: string;
  title: string;
  description: string;
  lessons: { id: string; slug: string; title: string; order: number }[];
  resumeLessonSlug: string | null;
  resumeLessonTitle: string | null;
  startLessonSlug: string | null;
  completedCount: number;
  totalCount: number;
  state: CourseProgressState;
  lastActivityAt: string | null;
};

export type LearnerDashboard = {
  courses: CourseSummary[];
  continueCourseId: string | null;
};

export async function getLearnerDashboard(): Promise<LearnerDashboard> {
  const learnerId = getCurrentLearnerId();
  const courses = await prisma.course.findMany({
    include: {
      lessons: {
        orderBy: { order: "asc" },
        include: { progress: { where: { learnerId } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const activeCourse = pickRecentActiveCourse(courses, learnerId);
  const summaries = courses.map((course) => {
    const summary = summariseCourseProgress(course, learnerId);
    const sortedLessons = [...course.lessons].sort((a, b) => a.order - b.order);
    const resumeLesson = pickResumeLesson(course.lessons, learnerId);
    return {
      id: course.id,
      slug: course.slug,
      title: course.title,
      description: course.description,
      lessons: sortedLessons.map((lesson) => ({
        id: lesson.id,
        slug: lesson.slug,
        title: lesson.title,
        order: lesson.order,
      })),
      resumeLessonSlug: resumeLesson?.slug ?? null,
      resumeLessonTitle: resumeLesson?.title ?? null,
      startLessonSlug: sortedLessons[0]?.slug ?? null,
      completedCount: summary.completed,
      totalCount: summary.total,
      state: summary.state,
      lastActivityAt: summary.lastActivityAt
        ? summary.lastActivityAt.toISOString()
        : null,
    };
  });
  return { courses: summaries, continueCourseId: activeCourse?.id ?? null };
}

export async function listCourses(): Promise<CourseSummary[]> {
  return (await getLearnerDashboard()).courses;
}

export async function getCourseWithLessons(slug: string) {
  const course = await prisma.course.findUnique({
    where: { slug },
    include: {
      lessons: {
        orderBy: { order: "asc" },
        include: {
          progress: { where: { learnerId: getCurrentLearnerId() } },
        },
      },
    },
  });
  return course;
}

export async function getLessonWithMessages(lessonId: string) {
  return prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      course: true,
      messages: { orderBy: { createdAt: "asc" } },
      progress: { where: { learnerId: getCurrentLearnerId() } },
    },
  });
}

export type SendTurnInput = {
  lessonId: string;
  learnerId: string;
  content: string;
};

export type SendTurnResult = {
  tutorMessage: { id: string; role: "tutor"; content: string; createdAt: string };
  learnerMessage: { id: string; role: "learner"; content: string; createdAt: string };
  isComplete: boolean;
};

/**
 * Enforce the course's sequential path at the shared mutation boundary.
 * Page links and redirects explain the policy, but API callers must not be
 * able to start or complete a locked lesson by bypassing the UI.
 */
export async function requireEnterableLesson(
  lessonId: string,
  learnerId: string,
) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      course: {
        include: {
          lessons: {
            orderBy: { order: "asc" },
            include: { progress: { where: { learnerId } } },
          },
        },
      },
    },
  });
  if (!lesson) throw new NotFoundError(`Lesson ${lessonId} not found`);
  if (!canEnterLesson(lesson.course.lessons, learnerId, lessonId)) {
    throw new LockedLessonError(
      "Complete the previous lesson before starting this lesson",
    );
  }
  return lesson;
}

/**
 * Append a learner turn, compute the next tutor turn using the rule-based
 * engine, persist the tutor turn, and update progress. Returns the new
 * messages and whether the lesson is now complete.
 */
export async function sendTurn(input: SendTurnInput): Promise<SendTurnResult> {
  const { lessonId, learnerId, content } = input;

  const lesson = await requireEnterableLesson(lessonId, learnerId);

  return prisma.$transaction(async (tx) => {
    // Fetch existing messages for the engine.
    const existing = await tx.message.findMany({
      where: { lessonId },
      orderBy: { createdAt: "asc" },
    });

    // If the lesson has no messages yet, ensure the opening tutor line is
    // present before the learner turn. This keeps the engine happy whether
    // or not the seed endpoint has fired.
    if (existing.length === 0) {
      const script = parseScript(lesson.script);
      const opening = selectTutorReply(script, []);
      await tx.message.create({
        data: {
          lessonId,
          role: "tutor",
          content: opening.content,
        },
      });
    }

    // Persist learner turn.
    const learnerMessage = await tx.message.create({
      data: { lessonId, role: "learner", content },
    });

    // Fetch the full conversation for the engine.
    const all = await tx.message.findMany({
      where: { lessonId },
      orderBy: { createdAt: "asc" },
    });
    const convo: ConversationTurn[] = all.map((m) => ({
      role: m.role === "tutor" ? "tutor" : "learner",
      content: m.content,
    }));

    const script = parseScript(lesson.script);
    const reply = selectTutorReply(script, convo);

    // The engine may emit a "lesson complete" terminal tutor line. Persist it
    // only if it's a real content line (not the terminal placeholder).
    let tutorRecord: { id: string; content: string; createdAt: Date; role: "tutor" };
    if (reply.isComplete) {
      // Use the terminal content only if there isn't already a terminal line.
      tutorRecord = {
        id: `terminal-${Date.now()}`,
        content: reply.content,
        role: "tutor",
        createdAt: new Date(),
      };
    } else {
      const created = await tx.message.create({
        data: { lessonId, role: "tutor", content: reply.content },
      });
      tutorRecord = {
        id: created.id,
        content: created.content,
        role: "tutor",
        createdAt: created.createdAt,
      };
    }

    // Mark progress. If the engine says the lesson is complete and the
    // terminal reply is the one we just produced, mark complete. Otherwise
    // ensure a progress row exists (touch it).
    const progressRow = await tx.progress.findUnique({
      where: { learnerId_lessonId: { learnerId, lessonId } },
    });
    if (reply.isComplete) {
      if (progressRow) {
        await tx.progress.update({
          where: { id: progressRow.id },
          data: { completed: true },
        });
      } else {
        await tx.progress.create({
          data: { learnerId, lessonId, completed: true },
        });
      }
    } else if (!progressRow) {
      await tx.progress.create({
        data: { learnerId, lessonId, completed: false },
      });
    }

    return {
      tutorMessage: {
        id: tutorRecord.id,
        role: "tutor" as const,
        content: tutorRecord.content,
        createdAt: tutorRecord.createdAt.toISOString(),
      },
      learnerMessage: {
        id: learnerMessage.id,
        role: "learner" as const,
        content: learnerMessage.content,
        createdAt: learnerMessage.createdAt.toISOString(),
      },
      isComplete: reply.isComplete,
    };
  });
}

/**
 * Force-complete a lesson (used by the "Mark complete" button — explicit
 * learner opt-in when the tutor offered the option).
 */
export async function markLessonComplete(
  lessonId: string,
  learnerId: string,
): Promise<void> {
  await requireEnterableLesson(lessonId, learnerId);
  await prisma.progress.upsert({
    where: { learnerId_lessonId: { learnerId, lessonId } },
    update: { completed: true },
    create: { learnerId, lessonId, completed: true },
  });
}

export class NotFoundError extends Error {
  readonly status = 404;
}
export class BadInputError extends Error {
  readonly status = 400;
}
export class LockedLessonError extends Error {
  readonly status = 409;
}

// Re-export for callers.
export { pickResumeLesson, canEnterLesson };
export { Prisma };
