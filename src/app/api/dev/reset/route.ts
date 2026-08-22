// Dev-only endpoint that wipes progress + messages so the e2e suite can
// start from a clean state. Gated on the explicit env flag ALLOW_DEV_RESET
// so it cannot be triggered in a real deployment by accident.
//
// Ownership note (issue #21): the endpoint leaves a genuinely empty learner
// state. The normal per-learner seed path creates one opening row only when
// that learner first enters an available lesson.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST() {
  if (process.env.ALLOW_DEV_RESET !== "true") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  // Wipe all learner state. Opening tutor lines are created lazily on first
  // lesson entry by the seed endpoint or by sendTurn.
  await prisma.message.deleteMany();
  await prisma.progress.deleteMany();
  return NextResponse.json({ ok: true });
}
