// POST /api/auth/login — verify email + password and set the session cookie.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { signSessionCookie, verifyPassword } from "@/lib/auth";
import {
  SESSION_MAX_AGE_SECONDS,
  buildSessionSetCookie,
} from "@/lib/auth-cookies";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON");
  }
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { email?: unknown }).email !== "string" ||
    typeof (body as { password?: unknown }).password !== "string"
  ) {
    return bad("Email and password are required");
  }
  const email = (body as { email: string }).email.trim().toLowerCase();
  const password = (body as { password: string }).password;

  const learner = await prisma.learner.findUnique({ where: { email } });
  if (!learner) {
    return bad("Invalid email or password", 401);
  }
  const ok = await verifyPassword(password, learner.passwordHash);
  if (!ok) {
    return bad("Invalid email or password", 401);
  }

  const cookieValue = await signSessionCookie(learner.id);
  const res = NextResponse.json({ id: learner.id, email: learner.email });
  res.headers.append("set-cookie", buildSessionSetCookie(cookieValue, SESSION_MAX_AGE_SECONDS));
  return res;
}