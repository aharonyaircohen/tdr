// Capture screenshots of the multi-course learner dashboard for issue #5
// proof.
//
// Drives: home → start course A → start course B → home with Continue card.
// Captures both desktop (1100x720) and mobile (375x720) viewports.
//
//   npx tsx scripts/capture-dashboard-screenshots.mts
import { chromium, type Page, type BrowserContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const OUT = resolve("docs/screenshots");
mkdirSync(OUT, { recursive: true });

async function reset(page: Page) {
  const res = await page.request.post(`${BASE}/api/dev/reset`);
  if (!res.ok()) throw new Error(`reset failed: ${res.status()} ${await res.text()}`);
}

async function shot(page: Page, name: string) {
  const file = resolve(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`captured ${file}`);
}

async function driveFirstTurn(page: Page, courseSlug: string, firstLessonSlug: string, learnerContent: string) {
  await page.goto(`${BASE}/courses/${courseSlug}/lessons/${firstLessonSlug}`);
  await page.waitForSelector("[data-testid=bubble-tutor]", { timeout: 15_000 });
  await page.getByTestId("chat-input").fill(learnerContent);
  await page.getByTestId("chat-send").click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="bubble-learner"]').length === 1,
    { timeout: 15_000 },
  );
}

const browser = await chromium.launch();

async function captureDesktop(label: string) {
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 1100, height: 760 },
  });
  const page = await ctx.newPage();

  // 1. Home with both courses Not started — no Continue card.
  await page.goto(BASE);
  await reset(page);
  await page.goto(BASE);
  await page.waitForLoadState("networkidle");
  await shot(page, `13-dashboard-empty-${label}`);

  // 2. Course A: one in-progress turn on lesson 1.
  await driveFirstTurn(page, "intro-to-llms", "what-is-llm", "next");

  // 3. Home — Continue card pointing at course A.
  await page.goto(BASE);
  await page.waitForLoadState("networkidle");
  await shot(page, `14-dashboard-one-course-${label}`);

  // 4. Course B: one in-progress turn on lesson 1.
  await driveFirstTurn(page, "prompting-patterns", "role-and-audience", "next");

  // 5. Home — Continue card switches to course B.
  await page.goto(BASE);
  await page.waitForLoadState("networkidle");
  await shot(page, `15-dashboard-two-courses-${label}`);

  await ctx.close();
}

await captureDesktop("desktop");

// Mobile (375x720) — same flow, narrower viewport.
{
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 375, height: 720 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  await page.goto(BASE);
  await reset(page);
  await page.goto(BASE);
  await page.waitForLoadState("networkidle");
  await shot(page, "13-dashboard-empty-mobile");

  await driveFirstTurn(page, "intro-to-llms", "what-is-llm", "next");

  await page.goto(BASE);
  await page.waitForLoadState("networkidle");
  await shot(page, "14-dashboard-one-course-mobile");

  await driveFirstTurn(page, "prompting-patterns", "role-and-audience", "next");

  await page.goto(BASE);
  await page.waitForLoadState("networkidle");
  await shot(page, "15-dashboard-two-courses-mobile");

  await ctx.close();
}

await browser.close();
console.log("\nDashboard screenshots written to docs/screenshots/");