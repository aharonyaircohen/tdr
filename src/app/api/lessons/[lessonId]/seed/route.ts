import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseScript, selectTutorReply, ConversationTurn } from "@/lib/script";
import { getCurrentLearnerId } from "@/lib/learner";

/**
 * Seed the first tutor turn of a lesson if no messages exist yet.
 * Used by the client on first visit so the chat UI is never empty.
 */
export async function POST(
  _req: Request,
  { params }: { params: { lessonId: string } },
) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: params.lessonId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
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
  const created = await prisma.message.create({
    data: {
      lessonId: lesson.id,
      role: "tutor",
      content: reply.content,
    },
  });
  // Touch a progress row so this lesson is now the resume target.
  await prisma.progress.upsert({
    where: {
      learnerId_lessonId: {
        learnerId: getCurrentLearnerId(),
        lessonId: lesson.id,
      },
    },
    update: {},
    create: {
      learnerId: getCurrentLearnerId(),
      lessonId: lesson.id,
      completed: false,
    },
  });
  return NextResponse.json({ message: created });
}