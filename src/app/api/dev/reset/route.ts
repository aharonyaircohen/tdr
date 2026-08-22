// Dev-only endpoint that wipes progress + messages so the e2e suite can
// start from a clean state. Gated on the explicit env flag ALLOW_DEV_RESET
// so it cannot be triggered in a real deployment by accident.
//
// Ownership note (issue #21): after the wipe we pre-seed the opening tutor
// line for every lesson under the *current* learner only. Each test sets
// its own `CURRENT_LEARNER_ID` before driving the dev server, so each test
// gets its own opening row and never observes another learner's history.
// The endpoint leaves a valid empty state — a fresh learner visiting any
// lesson will get exactly one opening row via the per-learner seed path.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseScript, selectTutorReply, ConversationTurn } from "@/lib/script";
import { getCurrentLearnerId } from "@/lib/learner";

export async function POST() {
  if (process.env.ALLOW_DEV_RESET !== "true") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const learnerId = getCurrentLearnerId();

  // Wipe all learner state. The opening tutor line for each lesson will be
  // created lazily on first visit by the seed endpoint or by sendTurn.
  await prisma.message.deleteMany();
  await prisma.progress.deleteMany();

  // Pre-seed the opening tutor line for every lesson so the UI does not
  // start with an empty transcript. Each opening is owned by the current
  // learner only — no progress rows are created; the course view's "no
  // progress" redirect logic is what we're testing.
  const lessons = await prisma.lesson.findMany();
  for (const lesson of lessons) {
    const script = parseScript(lesson.script);
    const opening = selectTutorReply(script, [] satisfies ConversationTurn[]);
    await prisma.message.create({
      data: {
        lessonId: lesson.id,
        learnerId,
        role: "tutor",
        content: opening.content,
      },
    });
  }

  return NextResponse.json({ ok: true, lessons: lessons.length });
}
