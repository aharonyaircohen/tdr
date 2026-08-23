// Issue #23 — Kody Brand Chat launch e2e journey.
//
// Drives the full real wire end-to-end against a stubbed Kody endpoint:
//   - register a learner via /api/auth/register
//   - visit /
//   - confirm the dashboard renders the "Open Kody Chat" form
//   - intercept the form-POST to https://kody.dev/api/client-session/external-launch
//   - capture the form body, decode the JWT, and verify every required claim
//
// The Playwright route interception keeps CI independent of any real Kody
// deployment. The assertion is built fresh per click (a brand-new jti on
// every dashboard render) and the form fields include owner/repo/brandSlug
// exactly as the brand-chat-access contract specifies.

import {
  test,
  expect,
  request as defaultRequest,
  type Page,
} from "@playwright/test";
import { decodeJwt, decodeProtectedHeader, jwtVerify, importJWK } from "jose";
import { setTimeout as sleep } from "node:timers/promises";

const KODY_LAUNCH_HOST = "https://kody.dev";
const KODY_LAUNCH_PATH = "/api/client-session/external-launch";

async function clearLearners(page: Page) {
  // Wipe messages/progress between tests so the e2e DB starts clean for
  // the launch flow; the route interception is the real assertion so we
  // don't need the existing learner-journey data fixtures.
  const ctx = await defaultRequest.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
  });
  const res = await ctx.post("/api/dev/reset");
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`reset failed: ${res.status()} ${await res.text()}`);
  }
}

async function registerLearner(
  page: Page,
  email: string,
  password: string,
): Promise<string> {
  const ctx = await defaultRequest.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
  });
  const res = await ctx.post("/api/auth/register", {
    data: { email, password },
    headers: { "content-type": "application/json" },
  });
  if (!res.ok()) {
    const text = await res.text();
    await ctx.dispose();
    throw new Error(`register failed: ${res.status()} ${text}`);
  }
  const body = (await res.json()) as { id: string; email: string };
  await ctx.dispose();
  return body.id;
}

test.describe("Kody Brand Chat launch (issue #23)", () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await clearLearners(page);
  });

  test("dashboard form-POSTs a fresh RS256 assertion to the Kody launch endpoint", async ({
    page,
  }) => {
    // Register via the page's request context so the session cookie is
    // set on the same browser context that will click the launch button.
    // The dev reset wipes learners, so the first call returns 200; if a
    // stale learner already exists from a prior run, fall back to login.
    const learnerEmail = "kody-alice@tdr.test";
    const learnerPassword = "hunter22-correcthorse";
    let registerRes = await page.request.post("/api/auth/register", {
      data: { email: learnerEmail, password: learnerPassword },
      headers: { "content-type": "application/json" },
    });
    let learnerId: string;
    if (registerRes.status() === 200) {
      const body = (await registerRes.json()) as { id: string; email: string };
      learnerId = body.id;
    } else {
      expect(registerRes.status()).toBe(409);
      const loginRes = await page.request.post("/api/auth/login", {
        data: { email: learnerEmail, password: learnerPassword },
        headers: { "content-type": "application/json" },
      });
      expect(loginRes.status()).toBe(200);
      const body = (await loginRes.json()) as { id: string; email: string };
      learnerId = body.id;
    }

    // Set up the Kody stub. The form posts to kody.dev; we redirect the
    // request to a same-origin URL that returns a 302 redirect to the
    // pretend Brand Chat session.
    let capturedBody: Record<string, string> | null = null;
    await page.route(`${KODY_LAUNCH_HOST}${KODY_LAUNCH_PATH}`, async (route) => {
      const req = route.request();
      const body = req.postData() ?? "";
      // application/x-www-form-urlencoded: assertion=...&owner=...&repo=...&brandSlug=...
      const parsed: Record<string, string> = {};
      for (const pair of body.split("&")) {
        const [k, v = ""] = pair.split("=");
        parsed[decodeURIComponent(k)] = decodeURIComponent(v);
      }
      capturedBody = parsed;
      await route.fulfill({
        status: 302,
        headers: {
          location:
            "/client/aharonyaircohen/tdr/tdr-default?assertion-stub=ok",
        },
      });
    });

    await page.goto("/");
    // The dashboard now renders the Open Kody Chat button because the
    // session cookie is present.
    const launchButton = page.getByTestId("open-kody-chat");
    await expect(launchButton).toBeVisible();
    await expect(launchButton).toHaveAttribute("type", "submit");

    // First render: capture the form and submit it.
    await Promise.all([
      page.waitForURL(/\/client\/aharonyaircohen\/tdr\/tdr-default/, {
        timeout: 15_000,
      }),
      launchButton.click(),
    ]);

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!.assertion).toBeTruthy();
    expect(capturedBody!.owner).toBe("aharonyaircohen");
    expect(capturedBody!.repo).toBe("tdr");
    expect(capturedBody!.brandSlug).toBe("tdr-default");

    // Decode the JWT header — must be RS256 with kid=tdr-kody-1.
    const header = decodeProtectedHeader(capturedBody!.assertion);
    expect(header.alg).toBe("RS256");
    expect(header.kid).toBe("tdr-kody-1");
    expect(header.typ).toBe("JWT");

    // Decode and inspect every required claim.
    const payload = decodeJwt(capturedBody!.assertion);
    expect(payload.sub).toBe(learnerId);
    expect(payload.iss).toBe("http://localhost:3000");
    expect(payload.aud).toBe("https://kody.dev");
    expect(payload.tenant_id).toBe("aharonyaircohen/tdr");
    expect(payload.brand_slug).toBe("tdr-default");
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    expect((payload.exp as number) - (payload.iat as number)).toBe(300);
    expect(typeof payload.jti).toBe("string");
    expect((payload.jti as string).length).toBeGreaterThan(8);

    // The JWT verifies against the JWKS published at /.well-known/jwks.json.
    const jwksCtx = await defaultRequest.newContext({
      baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    });
    const jwksRes = await jwksCtx.get("/.well-known/jwks.json");
    expect(jwksRes.ok()).toBe(true);
    const jwks = (await jwksRes.json()) as { keys: Array<Record<string, unknown>> };
    await jwksCtx.dispose();
    expect(jwks.keys.length).toBe(1);
    const key = await importJWK(jwks.keys[0], "RS256");
    const verified = await jwtVerify(capturedBody!.assertion, key, {
      algorithms: ["RS256"],
      issuer: "http://localhost:3000",
      audience: "https://kody.dev",
    });
    expect(verified.payload.sub).toBe(learnerId);
  });

  test("every render of / produces a fresh jti (single-use semantics)", async ({
    page,
  }) => {
    await page.goto("/");
    await page.request.post("/api/auth/register", {
      data: { email: "kody-fresh@tdr.test", password: "hunter22-correcthorse" },
      headers: { "content-type": "application/json" },
    });

    let captured: string[] = [];
    await page.route(`${KODY_LAUNCH_HOST}${KODY_LAUNCH_PATH}`, async (route) => {
      const body = route.request().postData() ?? "";
      const parsed: Record<string, string> = {};
      for (const pair of body.split("&")) {
        const [k, v = ""] = pair.split("=");
        parsed[decodeURIComponent(k)] = decodeURIComponent(v);
      }
      captured.push(parsed.assertion);
      await route.fulfill({
        status: 302,
        headers: { location: "/client/aharonyaircohen/tdr/tdr-default" },
      });
    });

    // Three renders → three distinct jti values.
    for (let i = 0; i < 3; i++) {
      await page.goto("/");
      await page.getByTestId("open-kody-chat").click();
      await page.waitForURL(/\/client\/aharonyaircohen\/tdr\/tdr-default/);
      await page.goBack();
    }
    expect(captured.length).toBeGreaterThanOrEqual(3);
    const jtis = captured.map((c) => decodeJwt(c).jti as string);
    expect(new Set(jtis).size).toBe(jtis.length);
  });

  test("a different learner id signs a different sub claim", async ({
    page,
    context,
  }) => {
    const learnerAId = await registerLearner(page, "alice@tdr.test", "hunter22-correcthorse");
    const learnerBId = await registerLearner(page, "bob@tdr.test", "hunter22-correcthorse");
    expect(learnerAId).not.toBe(learnerBId);

    // Sign in as A first.
    await page.goto("/");
    const loginA = await page.request.post("/api/auth/login", {
      data: { email: "alice@tdr.test", password: "hunter22-correcthorse" },
      headers: { "content-type": "application/json" },
    });
    expect(loginA.status()).toBe(200);
    const setCookieA = loginA.headers()["set-cookie"] ?? "";
    expect(setCookieA.toLowerCase()).toContain("tdr_session=");
    // Carry A's cookie into the page's request context.
    await context.addCookies(
      setCookieA.split(",").map((entry) => {
        const [name, ...rest] = entry.split(";")[0].split("=");
        return { name, value: rest.join("="), url: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000" };
      }),
    );

    let captured: { a?: string; b?: string } = {};
    await page.route(`${KODY_LAUNCH_HOST}${KODY_LAUNCH_PATH}`, async (route) => {
      const body = route.request().postData() ?? "";
      const parsed: Record<string, string> = {};
      for (const pair of body.split("&")) {
        const [k, v = ""] = pair.split("=");
        parsed[decodeURIComponent(k)] = decodeURIComponent(v);
      }
      const payload = decodeJwt(parsed.assertion);
      if (payload.sub === learnerAId) captured.a = parsed.assertion;
      else if (payload.sub === learnerBId) captured.b = parsed.assertion;
      await route.fulfill({
        status: 302,
        headers: { location: "/client/aharonyaircohen/tdr/tdr-default" },
      });
    });

    await page.goto("/");
    await page.getByTestId("open-kody-chat").click();
    await page.waitForURL(/\/client\/aharonyaircohen\/tdr\/tdr-default/);

    // Now log out and log in as B; the launch assertion must carry sub=B.
    await page.request.post("/api/auth/logout");
    const loginB = await page.request.post("/api/auth/login", {
      data: { email: "bob@tdr.test", password: "hunter22-correcthorse" },
      headers: { "content-type": "application/json" },
    });
    expect(loginB.status()).toBe(200);
    const setCookieB = loginB.headers()["set-cookie"] ?? "";
    await context.clearCookies();
    await context.addCookies(
      setCookieB.split(",").map((entry) => {
        const [name, ...rest] = entry.split(";")[0].split("=");
        return { name, value: rest.join("="), url: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000" };
      }),
    );

    await page.goto("/");
    await page.getByTestId("open-kody-chat").click();
    await page.waitForURL(/\/client\/aharonyaircohen\/tdr\/tdr-default/);

    expect(captured.a).toBeTruthy();
    expect(captured.b).toBeTruthy();
    expect(decodeJwt(captured.a!).sub).toBe(learnerAId);
    expect(decodeJwt(captured.b!).sub).toBe(learnerBId);
  });

  test("JWKS endpoint is reachable and carries the signing public key", async ({
    page,
  }) => {
    const ctx = await defaultRequest.newContext({
      baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    });
    const res = await ctx.get("/.well-known/jwks.json");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    expect(res.headers()["cache-control"]).toContain("public");
    expect(res.headers()["cache-control"]).toContain("max-age=300");
    const body = (await res.json()) as { keys: Array<Record<string, unknown>> };
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].kid).toBe("tdr-kody-1");
    expect(body.keys[0].alg).toBe("RS256");
    expect(body.keys[0].use).toBe("sig");
    expect(body.keys[0].kty).toBe("RSA");
    await ctx.dispose();
    void sleep; // keep the named import available for future tests
  });
});