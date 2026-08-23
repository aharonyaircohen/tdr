// Session cookie helpers that work in both Next.js runtime AND in tests
// (where calling `cookies()` from `next/headers` throws because there is
// no request scope). At runtime we use the response's `Set-Cookie` header
// directly and parse the request's `Cookie` header — that way we don't
// depend on the cookies() API and tests can exercise the full route
// surface without a Next.js request context.

import { SESSION_COOKIE_NAME } from "./auth";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function isSecureContext(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.TDR_INSECURE_COOKIES !== "true"
  );
}

export function buildSessionSetCookie(value: string, maxAge: number): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isSecureContext()) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearSetCookie(): string {
  return buildSessionSetCookie("", 0);
}

export function readSessionCookieFromRequest(
  request: Request,
): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const name = trimmed.slice(0, eq);
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return null;
}