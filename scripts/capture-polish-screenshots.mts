// Capture the issue #3 polish screenshots: catalog fixed (desktop + mobile),
// compact composer (empty + grown with long text), and mobile chat.
//
// Runs against the dev server already started at $E2E_BASE_URL. Same pattern
// as scripts/capture-proof.mts but produces the polish-specific screenshots.
//
//   npx tsx scripts/capture-polish-screenshots.mts
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

async function viewportShot(page: Page, name: string) {
  const file = resolve(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`captured ${file}`);
}

async function enterLesson(page: Page) {
  await page.goto(BASE);
  await page.getByTestId("open-course-intro-to-llms").click();
  await page.waitForURL(/\/lessons\/what-is-llm$/, { timeout: 15_000 });
  await page.waitForSelector("[data-testid=bubble-tutor]", { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
}

const browser = await chromium.launch();

// ---------- Desktop catalog: stray bullet is gone ----------
{
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 1100, height: 720 },
  });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await reset(page);
  await page.goto(BASE);
  await page.waitForLoadState("networkidle");
  await shot(page, "08-catalog-fixed-desktop");
  await ctx.close();
}

// ---------- Mobile catalog ----------
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
  await shot(page, "09-catalog-fixed-mobile");
  await ctx.close();
}

// ---------- Compact composer (empty) ----------
{
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 1100, height: 720 },
  });
  const page = await ctx.newPage();
  await enterLesson(page);
  await shot(page, "10-composer-empty");
  await ctx.close();
}

// ---------- Compact composer grown with a long reply ----------
{
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 1100, height: 720 },
  });
  const page = await ctx.newPage();
  await enterLesson(page);
  await page
    .getByTestId("chat-input")
    .fill(
      "I've heard about them on podcasts and read a couple of beginner articles, " +
        "so I know a little about how they work but I would not call myself an expert.\n" +
        "Also I have used one to help with code refactoring and another time to summarize a long document.",
    );
  await page.waitForTimeout(200);
  await shot(page, "11-composer-long");
  await ctx.close();
}

// ---------- Mobile chat with composer + scrollable list ----------
{
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: 375, height: 720 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await enterLesson(page);
  // Send a couple of turns so the transcript has both bubbles.
  await page.getByTestId("chat-input").fill("next");
  await page.getByTestId("chat-send").click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="bubble-learner"]').length === 1,
    { timeout: 15_000 },
  );
  await page
    .getByTestId("chat-input")
    .fill("I've heard about them on podcasts.");
  await page.getByTestId("chat-send").click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="bubble-learner"]').length === 2,
    { timeout: 15_000 },
  );
  await page.getByTestId("chat-form").scrollIntoViewIfNeeded();
  await viewportShot(page, "12-lesson-mobile");
  await ctx.close();
}

await browser.close();
console.log("\nPolish screenshots written to docs/screenshots/");
