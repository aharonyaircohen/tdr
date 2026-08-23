import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseScript, selectTutorReply, ConversationTurn } from "@/lib/script";
import { getCurrentLearnerId } from "@/lib/learner";
import {
  requireEnterableLesson,
  LockedLessonError,
  NotFoundError,
} from "@/lib/service";

/**
 * Seed the first tutor turn of a lesson if no messages exist yet.
 * Used by the client on first visit so the chat UI is never empty.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  const { lessonId } = await params;
  const learnerId = await getCurrentLearnerId();
  try {
    await requireEnterableLesson(lessonId, learnerId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof LockedLessonError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      messages: {
        where: { learnerId },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }
  if (lesson.messages.length > 0) {
    return NextResponse.json({
      message: lesson.messages[0],
    });
  }
  const script = parseScript(lesson.script);
  const reply = selectTutorReply(script, [] satisfies ConversationTurn[]);
  // The deterministic id includes the learner so two learners visiting the
  // same lesson concurrently each get their own opening row (and the
  // upsert makes that first write atomic across Strict Mode, retries, and
  // multiple tabs for the same learner).
  const seedMessageId = `lesson-seed:${lesson.id}:${learnerId}`;
  const created = await prisma.message.upsert({
    where: { id: seedMessageId },
    update: {},
    create: {
      id: seedMessageId,
      lessonId: lesson.id,
      learnerId,
      role: "tutor",
      content: reply.content,
    },
  });
  // Touch a progress row so this lesson is now the resume target.
  await prisma.progress.upsert({
    where: {
      learnerId_lessonId: {
        learnerId,
        lessonId: lesson.id,
      },
    },
    update: {},
    create: {
      learnerId,
      lessonId: lesson.id,
      completed: false,
    },
  });
  return NextResponse.json({ message: created });
}
