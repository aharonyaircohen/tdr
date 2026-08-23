// POST /api/auth/logout — clear the session cookie.

import { NextResponse } from "next/server";
import { buildClearSetCookie } from "@/lib/auth-cookies";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.append("set-cookie", buildClearSetCookie());
  return res;
}