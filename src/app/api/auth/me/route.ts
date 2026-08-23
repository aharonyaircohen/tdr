// GET /api/auth/me — return the current learner when authenticated.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySessionCookie } from "@/lib/auth";
import { readSessionCookieFromRequest } from "@/lib/auth-cookies";

export async function GET(req: Request) {
  const cookieValue = readSessionCookieFromRequest(req);
  const learnerId = await verifySessionCookie(cookieValue);
  if (!learnerId) {
    return NextResponse.json({ learner: null }, { status: 200 });
  }
  const learner = await prisma.learner.findUnique({
    where: { id: learnerId },
    select: { id: true, email: true },
  });
  if (!learner) {
    return NextResponse.json({ learner: null }, { status: 200 });
  }
  return NextResponse.json({ learner });
}