// Unit tests for src/lib/auth.ts — password hashing + session cookie
// sign/verify. Pure functions over the crypto primitives; no DB needed.

import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, signSessionCookie, verifySessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth";

describe("password hashing", () => {
  it("verifyPassword round-trips a freshly hashed value", async () => {
    const hash = await hashPassword("hunter22-correcthorse");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("hunter22-correcthorse", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("hunter22-correcthorse");
    expect(await verifyPassword("hunter22-wronghorse", hash)).toBe(false);
  });

  it("produces a different hash for the same plaintext on a fresh call", async () => {
    const a = await hashPassword("hunter22-correcthorse");
    const b = await hashPassword("hunter22-correcthorse");
    expect(a).not.toBe(b);
    // Both still verify.
    expect(await verifyPassword("hunter22-correcthorse", a)).toBe(true);
    expect(await verifyPassword("hunter22-correcthorse", b)).toBe(true);
  });

  it("returns false for a malformed envelope", async () => {
    expect(await verifyPassword("hunter22-correcthorse", "not-an-envelope")).toBe(false);
    expect(await verifyPassword("hunter22-correcthorse", "scrypt$abc$64$xx$yy")).toBe(false);
  });

  it("rejects empty plaintext inputs", async () => {
    await expect(hashPassword("")).rejects.toThrow();
    expect(await verifyPassword("", "scrypt$16384$64$AAAA$BBBB")).toBe(false);
  });
});

describe("session cookies", () => {
  it("signs a cookie that verifies back to the same learner id", async () => {
    const cookie = await signSessionCookie("learner-abc");
    expect(await verifySessionCookie(cookie)).toBe("learner-abc");
  });

  it("rejects a tampered cookie value", async () => {
    const cookie = await signSessionCookie("learner-abc");
    const tampered = cookie.replace("learner-abc", "learner-evil");
    expect(await verifySessionCookie(tampered)).toBeNull();
  });

  it("rejects a cookie with a truncated signature", async () => {
    const cookie = await signSessionCookie("learner-abc");
    const parts = cookie.split(".");
    const truncated = `${parts[0]}.${parts[1]}.${parts[2]}.aaaa`;
    expect(await verifySessionCookie(truncated)).toBeNull();
  });

  it("rejects null / empty / wrong-shape input", async () => {
    expect(await verifySessionCookie(null)).toBeNull();
    expect(await verifySessionCookie(undefined)).toBeNull();
    expect(await verifySessionCookie("")).toBeNull();
    expect(await verifySessionCookie("only-one-segment")).toBeNull();
    expect(await verifySessionCookie("a.b.c")).toBeNull();
  });

  it("rejects an expired cookie", async () => {
    const cookie = await signSessionCookie("learner-old");
    const parts = cookie.split(".");
    // Rewrite the iat to be 8 days ago — past the 7-day max-age.
    const oldIat = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 8;
    const expired = `${parts[0]}.${oldIat}.${parts[2]}.${parts[3]}`;
    expect(await verifySessionCookie(expired)).toBeNull();
  });

  it("exposes the canonical cookie name", () => {
    expect(SESSION_COOKIE_NAME).toBe("tdr_session");
  });
});