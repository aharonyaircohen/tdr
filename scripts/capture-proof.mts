// Capture screenshots of the full learner journey for docs/proof.md.
// Runs against the dev server already started at $E2E_BASE_URL.
//
//   npx tsx scripts/capture-proof.mts
import { chromium, type Page } from "@playwright/test";
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();

// Ensure clean state.
await page.goto(BASE);
await reset(page);

console.log("\n--- 1. Open the home page ---");
await page.goto(BASE);
await shot(page, "01-home");

console.log("\n--- 2. Open the course, land in lesson 1 ---");
await page.getByTestId("open-course-intro-to-llms").click();
await page.waitForURL(/\/courses\/intro-to-llms\/lessons\/what-is-llm$/);
await page.waitForSelector("[data-testid=bubble-tutor]", { timeout: 15_000 });
await shot(page, "02-lesson1-opening");

console.log("\n--- 3. Exchange three chat turns on lesson 1 ---");
const input = page.getByTestId("chat-input");
const send = page.getByTestId("chat-send");

await input.fill("next");
await send.click();
await page.waitForFunction(
  () => document.querySelectorAll('[data-testid="bubble-learner"]').length === 1,
  { timeout: 15_000 },
);

await input.fill("I've heard about them on podcasts.");
await send.click();
await page.waitForFunction(
  () => document.querySelectorAll('[data-testid="bubble-learner"]').length === 2,
  { timeout: 15_000 },
);

await input.fill("done");
await send.click();
await page.waitForSelector('[data-testid="lesson-complete"]', { timeout: 15_000 });
await shot(page, "03-lesson1-complete");

console.log("\n--- 4. Resume after closing the browser ---");
await ctx.close();
const fresh = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page2 = await fresh.newPage();
await page2.goto(BASE);
await page2.getByTestId("open-course-intro-to-llms").click();
await page2.waitForURL(/\/lessons\/tokens-and-context$/, { timeout: 15_000 });
await page2.waitForSelector('[data-testid="bubble-tutor"]', { timeout: 15_000 });
await shot(page2, "04-lesson2-resumed");

console.log("\n--- 5. Drive lesson 2 to completion ---");
const input2 = page2.getByTestId("chat-input");
const send2 = page2.getByTestId("chat-send");
await input2.fill("next");
await send2.click();
await page2.waitForFunction(
  () => document.querySelectorAll('[data-testid="bubble-learner"]').length === 1,
);
await input2.fill("three tokens");
await send2.click();
await page2.waitForFunction(
  () => document.querySelectorAll('[data-testid="bubble-learner"]').length === 2,
);
await input2.fill("done");
await send2.click();
await page2.waitForSelector('[data-testid="lesson-complete"]', { timeout: 15_000 });

console.log("\n--- 6. Navigate to lesson 3 via Next-lesson link ---");
await page2.getByTestId("next-lesson").click();
await page2.waitForURL(/\/lessons\/prompts-are-programs$/, { timeout: 15_000 });
await page2.waitForSelector('[data-testid="bubble-tutor"]', { timeout: 15_000 });
await shot(page2, "05-lesson3-opening");

const input3 = page2.getByTestId("chat-input");
const send3 = page2.getByTestId("chat-send");
await input3.fill("next");
await send3.click();
await page2.waitForFunction(
  () => document.querySelectorAll('[data-testid="bubble-learner"]').length === 1,
);
await input3.fill("clear intent");
await send3.click();
await page2.waitForFunction(
  () => document.querySelectorAll('[data-testid="bubble-learner"]').length === 2,
);
await input3.fill("done");
await send3.click();
await page2.waitForSelector('[data-testid="lesson-complete"]', { timeout: 15_000 });
await shot(page2, "06-lesson3-complete");

console.log("\n--- 7. Course overview shows 3 / 3 complete ---");
await page2.getByTestId("back-to-course").click();
await page2.waitForURL(/\/courses\/intro-to-llms$/);
await page2.waitForSelector('[data-testid="progress-count"]');
await shot(page2, "07-course-overview");

await browser.close();
console.log("\nAll screenshots written to docs/screenshots/");
