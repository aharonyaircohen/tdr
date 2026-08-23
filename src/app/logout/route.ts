// POST /logout — clear the session cookie and redirect home.

import { NextResponse } from "next/server";
import { buildClearSetCookie } from "@/lib/auth-cookies";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/", req.url));
  res.headers.append("set-cookie", buildClearSetCookie());
  return res;
}