// Issue #23 — cookie-backed identity isolation e2e journey.
//
// Real learner registration + login + chat isolation, all driven through
// the browser against the running dev server. Proves the cookie subject
// owns the transcript they create and that another registered learner's
// session cannot see it.

import {
  test,
  expect,
  request as defaultRequest,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { setTimeout as sleep } from "node:timers/promises";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

async function resetDevDb() {
  const ctx = await defaultRequest.newContext({ baseURL: BASE_URL });
  const res = await ctx.post("/api/dev/reset");
  await ctx.dispose();
  if (!res.ok()) {
    throw new Error(`reset failed: ${res.status()} ${await res.text()}`);
  }
}

async function newContext(
  browser: BrowserContext["browser"] | undefined,
  baseURL: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const b = browser!;
  const ctx = await b.newContext({ baseURL });
  const page = await ctx.newPage();
  return { ctx, page };
}

test.describe("Cookie-backed identity isolation (issue #23)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async () => {
    await resetDevDb();
  });

  test("Alice and Bob register, drive separate transcripts, neither sees the other's", async ({
    browser,
  }) => {
    // ----- Alice's session -----
    const alice = await newContext(browser, BASE_URL);
    const aliceEmail = "alice@tdr.test";
    const alicePassword = "hunter22-correcthorse";

    // Register Alice and follow the redirect to /. The login page defaults
    // to "login" mode, so we must toggle into "register" before submitting
    // or the API returns 401 (Alice doesn't exist yet on a fresh dev.db).
    await alice.page.goto("/login");
    await alice.page.getByTestId("toggle-register").click();
    await alice.page.getByTestId("auth-email").fill(aliceEmail);
    await alice.page.getByTestId("auth-password").fill(alicePassword);
    await alice.page.getByTestId("auth-submit").click();
    await alice.page.waitForURL(BASE_URL + "/", { timeout: 15_000 });

    // Start the LLM course, drive a chat turn.
    await alice.page.goto(BASE_URL + "/");
    await alice.page.getByTestId("start-course-intro-to-llms").click();
    await alice.page.waitForURL(/\/lessons\/what-is-llm$/, { timeout: 15_000 });
    await expect(
      alice.page.getByTestId("bubble-tutor").first(),
    ).toBeVisible({ timeout: 15_000 });

    await alice.page.getByTestId("chat-input").fill("next");
    await alice.page.getByTestId("chat-send").click();
    await expect(
      alice.page
        .getByTestId("chat-transcript")
        .locator("[data-testid=bubble-learner]"),
    ).toHaveCount(1, { timeout: 10_000 });

    const aliceTurns = await alice.page
      .getByTestId("chat-transcript")
      .locator("[data-testid=bubble-learner]")
      .allTextContents();
    expect(aliceTurns).toEqual(["next"]);

    // Log Alice out.
    await alice.page.request.post("/api/auth/logout");
    await alice.ctx.clearCookies();

    // ----- Bob's session -----
    const bob = await newContext(browser, BASE_URL);
    const bobEmail = "bob@tdr.test";
    const bobPassword = "hunter22-correcthorse";
    await bob.page.goto("/login");
    await bob.page.getByTestId("toggle-register").click();
    await bob.page.getByTestId("auth-email").fill(bobEmail);
    await bob.page.getByTestId("auth-password").fill(bobPassword);
    await bob.page.getByTestId("auth-submit").click();
    await bob.page.waitForURL(BASE_URL + "/", { timeout: 15_000 });

    await bob.page.goto(BASE_URL + "/");
    await bob.page.getByTestId("start-course-intro-to-llms").click();
    await bob.page.waitForURL(/\/lessons\/what-is-llm$/, { timeout: 15_000 });
    await expect(
      bob.page.getByTestId("bubble-tutor").first(),
    ).toBeVisible({ timeout: 15_000 });

    // Bob's opening tutor line must be there but he must NOT see Alice's
    // "next" learner turn.
    const bobTurns = await bob.page
      .getByTestId("chat-transcript")
      .locator("[data-testid=bubble-learner]")
      .allTextContents();
    expect(bobTurns).toEqual([]);

    // Drive Bob's own first turn.
    await bob.page.getByTestId("chat-input").fill("ok");
    await bob.page.getByTestId("chat-send").click();
    await expect(
      bob.page
        .getByTestId("chat-transcript")
        .locator("[data-testid=bubble-learner]"),
    ).toHaveCount(1, { timeout: 10_000 });

    // ----- Reload Alice's view: she must still see only her own turn -----
    // Alice was logged out above to prove the logout endpoint works; the
    // page now falls back to the env-var identity and can't see her own
    // turns. Re-login so the lesson read picks up Alice's learner id and
    // her chat history comes back.
    const aliceReLogin = await alice.page.request.post("/api/auth/login", {
      data: { email: aliceEmail, password: alicePassword },
      headers: { "content-type": "application/json" },
    });
    expect(aliceReLogin.status()).toBe(200);
    const aliceSetCookie = aliceReLogin.headers()["set-cookie"] ?? "";
    expect(aliceSetCookie.toLowerCase()).toContain("tdr_session=");
    await alice.ctx.addCookies(
      aliceSetCookie.split(",").map((entry) => {
        const [name, ...rest] = entry.split(";")[0].split("=");
        return {
          name,
          value: rest.join("="),
          url: BASE_URL,
        };
      }),
    );
    await alice.page.goto(BASE_URL + "/courses/intro-to-llms/lessons/what-is-llm");
    await expect(
      alice.page.getByTestId("bubble-tutor").first(),
    ).toBeVisible({ timeout: 15_000 });
    const aliceAfter = await alice.page
      .getByTestId("chat-transcript")
      .locator("[data-testid=bubble-learner]")
      .allTextContents();
    expect(aliceAfter).toEqual(["next"]);
    // Bob's "ok" must not appear in Alice's transcript.
    expect(aliceAfter.some((t) => t === "ok")).toBe(false);

    // ----- Bob's dashboard reflects his own progress -----
    await bob.page.goto(BASE_URL + "/");
    const bobContinue = bob.page.getByTestId("continue-cta");
    await expect(bobContinue).toBeVisible();

    await alice.ctx.close();
    await bob.ctx.close();
  });

  test("the env-var fallback (two-learner isolation) keeps working — backwards compatibility", async ({
    browser,
  }) => {
    // Spawn a second dev server as bob with CURRENT_LEARNER_ID=bob; the
    // existing two-learner-isolation.spec.ts already does this and proves
    // DB-level transcript isolation. Here we re-prove the same invariant
    // from a single browser context that POSTs to both dev servers.

    const alicePort = Number(new URL(BASE_URL).port || "3000");
    const bobPort = alicePort + 1;
    const bobUrl = `http://127.0.0.1:${bobPort}`;
    const { spawn } = await import("node:child_process");
    const bobServer = spawn(
      "npx",
      ["next", "dev", "-p", String(bobPort)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: "file:./dev.db",
          CURRENT_LEARNER_ID: "bob-env-learner",
          ALLOW_DEV_RESET: "true",
          NODE_ENV: "development",
          NEXT_TELEMETRY_DISABLED: "1",
          NEXT_DIST_DIR: ".next-bob",
        } as Record<string, string>,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    bobServer.stdout?.on("data", () => {});
    bobServer.stderr?.on("data", () => {});

    // Wait for bob's server to be ready.
    const probe = await defaultRequest.newContext({ baseURL: bobUrl });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await probe.get("/");
        if (r.ok()) {
          ready = true;
          break;
        }
      } catch {
        // not ready
      }
      await sleep(500);
    }
    await probe.dispose();
    if (!ready) {
      bobServer.kill("SIGTERM");
      throw new Error(`bob server failed to start on ${bobUrl}`);
    }

    try {
      // Seed alice's openings via her server.
      const aliceReq = await defaultRequest.newContext({ baseURL: BASE_URL });
      const reset = await aliceReq.post("/api/dev/reset");
      if (!reset.ok()) {
        await aliceReq.dispose();
        throw new Error(`alice reset failed: ${reset.status()}`);
      }
      await aliceReq.dispose();

      const aliceCtx = await browser.newContext({ baseURL: BASE_URL });
      const alicePage = await aliceCtx.newPage();
      await alicePage.goto(BASE_URL + "/");
      await alicePage.getByTestId("start-course-intro-to-llms").click();
      await alicePage.waitForURL(/\/lessons\/what-is-llm$/, { timeout: 15_000 });
      await expect(
        alicePage.getByTestId("bubble-tutor").first(),
      ).toBeVisible({ timeout: 15_000 });
      await alicePage.getByTestId("chat-input").fill("next");
      await alicePage.getByTestId("chat-send").click();
      await expect(
        alicePage
          .getByTestId("chat-transcript")
          .locator("[data-testid=bubble-learner]"),
      ).toHaveCount(1, { timeout: 10_000 });

      const bobCtx = await browser.newContext({ baseURL: bobUrl });
      const bobPage = await bobCtx.newPage();
      await bobPage.goto(bobUrl + "/");
      await bobPage.getByTestId("start-course-intro-to-llms").click();
      await bobPage.waitForURL(/\/lessons\/what-is-llm$/, { timeout: 15_000 });
      await expect(
        bobPage.getByTestId("bubble-tutor").first(),
      ).toBeVisible({ timeout: 15_000 });
      // Bob's transcript must not show alice's "next".
      const bobLearnerBubbles = await bobPage
        .getByTestId("chat-transcript")
        .locator("[data-testid=bubble-learner]")
        .allTextContents();
      expect(bobLearnerBubbles).toEqual([]);

      await aliceCtx.close();
      await bobCtx.close();
    } finally {
      bobServer.kill("SIGTERM");
      await sleep(200);
      if (!bobServer.killed) bobServer.kill("SIGKILL");
    }
  });
});