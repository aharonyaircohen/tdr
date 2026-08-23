// POST /api/auth/register — create a new Learner, hash their password with
// scrypt, and set the session cookie. Returns the learner record.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, signSessionCookie } from "@/lib/auth";
import {
  SESSION_MAX_AGE_SECONDS,
  buildSessionSetCookie,
} from "@/lib/auth-cookies";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  if (!EMAIL_RE.test(email) || email.length > 320) {
    return bad("Email is not a valid address");
  }
  if (password.length < 8) {
    return bad("Password must be at least 8 characters");
  }
  if (password.length > 256) {
    return bad("Password is too long");
  }

  const existing = await prisma.learner.findUnique({ where: { email } });
  if (existing) {
    return bad("Email is already registered", 409);
  }
  const passwordHash = await hashPassword(password);
  const learner = await prisma.learner.create({
    data: { email, passwordHash },
    select: { id: true, email: true },
  });

  const cookieValue = await signSessionCookie(learner.id);
  const res = NextResponse.json({ id: learner.id, email: learner.email });
  res.headers.append("set-cookie", buildSessionSetCookie(cookieValue, SESSION_MAX_AGE_SECONDS));
  return res;
}