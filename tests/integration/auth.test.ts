// Integration test for the auth API surface (issue #23). Drives the real
// register → login → logout round-trip against the test SQLite DB and
// proves the cookie subject matches the registered learner.
//
// This complements the existing journey.test.ts "auth + isolation" block
// added by issue #23; the route-handler assertions here live separately
// so a regression on cookie attributes or session secret handling surfaces
// in its own failure.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let registerPOST: typeof import("@/app/api/auth/register/route").POST;
let loginPOST: typeof import("@/app/api/auth/login/route").POST;
let logoutPOST: typeof import("@/app/api/auth/logout/route").POST;
let meGET: typeof import("@/app/api/auth/me/route").GET;

beforeEach(async () => {
  // Re-import per test so the singleton client picks up the fresh DB.
  await prisma.learner.deleteMany();
  registerPOST = (await import("@/app/api/auth/register/route")).POST;
  loginPOST = (await import("@/app/api/auth/login/route")).POST;
  logoutPOST = (await import("@/app/api/auth/logout/route")).POST;
  meGET = (await import("@/app/api/auth/me/route")).GET;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function jsonBody(body: unknown) {
  return {
    method: "POST" as const,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("auth API round-trip", () => {
  it("registers a new learner and persists a hashed password", async () => {
    const res = await registerPOST(
      new Request("http://localhost/register", jsonBody({
        email: "alice@tdr.test",
        password: "hunter22-correcthorse",
      })),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { id: string; email: string };
    expect(data.email).toBe("alice@tdr.test");

    const row = await prisma.learner.findUnique({ where: { id: data.id } });
    expect(row).not.toBeNull();
    expect(row!.email).toBe("alice@tdr.test");
    // The stored hash must NOT be the plaintext.
    expect(row!.passwordHash).not.toBe("hunter22-correcthorse");
    expect(row!.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  it("rejects a duplicate email with 409", async () => {
    await registerPOST(
      new Request("http://localhost/register", jsonBody({
        email: "alice@tdr.test",
        password: "hunter22-correcthorse",
      })),
    );
    const res = await registerPOST(
      new Request("http://localhost/register", jsonBody({
        email: "alice@tdr.test",
        password: "another-long-password",
      })),
    );
    expect(res.status).toBe(409);
  });

  it("rejects a too-short password with 400", async () => {
    const res = await registerPOST(
      new Request("http://localhost/register", jsonBody({
        email: "alice@tdr.test",
        password: "short",
      })),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a malformed email with 400", async () => {
    const res = await registerPOST(
      new Request("http://localhost/register", jsonBody({
        email: "not-an-email",
        password: "hunter22-correcthorse",
      })),
    );
    expect(res.status).toBe(400);
  });

  it("login succeeds with the right password and sets the cookie", async () => {
    const regRes = await registerPOST(
      new Request("http://localhost/register", jsonBody({
        email: "bob@tdr.test",
        password: "hunter22-correcthorse",
      })),
    );
    expect(regRes.status).toBe(200);
    const regData = (await regRes.json()) as { id: string; email: string };

    const res = await loginPOST(
      new Request("http://localhost/login", jsonBody({
        email: "bob@tdr.test",
        password: "hunter22-correcthorse",
      })),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { id: string; email: string };
    expect(data.id).toBe(regData.id);
    expect(data.email).toBe("bob@tdr.test");
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie!.toLowerCase()).toContain("tdr_session=");
    expect(setCookie!.toLowerCase()).toContain("httponly");
    expect(setCookie!.toLowerCase()).toContain("samesite=lax");
    expect(setCookie!.toLowerCase()).toContain("path=/");
    expect(setCookie!.toLowerCase()).toMatch(/max-age=\d+/);
  });

  it("login rejects the wrong password with 401 and no cookie", async () => {
    await registerPOST(
      new Request("http://localhost/register", jsonBody({
        email: "bob@tdr.test",
        password: "hunter22-correcthorse",
      })),
    );
    const res = await loginPOST(
      new Request("http://localhost/login", jsonBody({
        email: "bob@tdr.test",
        password: "wrong-horse",
      })),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("login is case-insensitive on email", async () => {
    await registerPOST(
      new Request("http://localhost/register", jsonBody({
        email: "bob@tdr.test",
        password: "hunter22-correcthorse",
      })),
    );
    const res = await loginPOST(
      new Request("http://localhost/login", jsonBody({
        email: "  BOB@TDR.TEST  ",
        password: "hunter22-correcthorse",
      })),
    );
    expect(res.status).toBe(200);
  });

  it("login round-trip: register → logout → re-login → cookie subject matches", async () => {
    const reg = await registerPOST(
      new Request("http://localhost/register", jsonBody({
        email: "carol@tdr.test",
        password: "hunter22-correcthorse",
      })),
    );
    expect(reg.status).toBe(200);
    const learnerId = ((await reg.json()) as { id: string }).id;

    // Re-login as the freshly registered learner.
    const login = await loginPOST(
      new Request("http://localhost/login", jsonBody({
        email: "carol@tdr.test",
        password: "hunter22-correcthorse",
      })),
    );
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!;
    const m = cookie.match(/tdr_session=([^;]+)/);
    expect(m).not.toBeNull();
    const cookieValue = m![1];
    expect(cookieValue.length).toBeGreaterThan(0);

    // /api/auth/me with the new cookie must report this learner.
    const meRes = await meGET(
      new Request("http://localhost/me", {
        headers: { cookie: `tdr_session=${cookieValue}` },
      }),
    );
    expect(meRes.status).toBe(200);
    const me = (await meRes.json()) as {
      learner: { id: string; email: string } | null;
    };
    expect(me.learner?.id).toBe(learnerId);
    expect(me.learner?.email).toBe("carol@tdr.test");

    // Logout clears the cookie.
    const logout = await logoutPOST();
    expect(logout.status).toBe(200);
    const cleared = logout.headers.get("set-cookie");
    expect(cleared).not.toBeNull();
    expect(cleared!.toLowerCase()).toContain("tdr_session=");
    expect(cleared!.toLowerCase()).toContain("max-age=0");
  });

  it("/api/auth/me returns learner=null when no cookie is present", async () => {
    const me = await meGET(new Request("http://localhost/me"));
    expect(me.status).toBe(200);
    const body = (await me.json()) as { learner: null };
    expect(body.learner).toBeNull();
  });

  it("/api/auth/me returns learner=null for a tampered cookie", async () => {
    const me = await meGET(
      new Request("http://localhost/me", {
        headers: { cookie: "tdr_session=not.a.valid.cookie" },
      }),
    );
    expect(me.status).toBe(200);
    const body = (await me.json()) as { learner: null };
    expect(body.learner).toBeNull();
  });
});