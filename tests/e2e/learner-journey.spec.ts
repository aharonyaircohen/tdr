import { test, expect, request } from "@playwright/test";

test.describe("Learner journey — full vertical slice", () => {
  test.beforeEach(async () => {
    // Ensure each test starts from a clean state. globalSetup also does this
    // once before the suite, but a stale run can leave progress rows behind.
    const ctx = await request.newContext({
      baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    });
    const res = await ctx.post("/api/dev/reset");
    if (!res.ok()) {
      throw new Error(`reset failed: ${res.status()} ${await res.text()}`);
    }
    await ctx.dispose();
  });

  test("open → chat → progress → resume after reload", async ({ page }) => {
    // 1. Open the app and pick the seeded course.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /The Digital Reality/i })).toBeVisible();
    await page.getByTestId("open-course-intro-to-llms").click();

    // The course view should auto-redirect into the first lesson.
    await expect(page).toHaveURL(/\/courses\/intro-to-llms\/lessons\/what-is-llm$/);

    // 2. See lesson progress: 0 / 3 to start.
    await expect(page.getByTestId("lesson-progress")).toContainText("0 / 3");

    // 3. Wait for the opening tutor turn.
    const tutor = page.getByTestId("bubble-tutor");
    await expect(tutor.first()).toBeVisible({ timeout: 15_000 });

    // Capture initial transcript count for assertion later.
    const transcript = page.getByTestId("chat-transcript");

    // 4. Exchange three chat turns on the first lesson.
    const input = page.getByTestId("chat-input");
    await input.fill("next");
    await page.getByTestId("chat-send").click();
    await expect(transcript.locator("[data-testid=bubble-learner]")).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(transcript.locator("[data-testid=bubble-tutor]")).toHaveCount(2, {
      timeout: 10_000,
    });

    await input.fill("I've heard about them on podcasts.");
    await page.getByTestId("chat-send").click();
    await expect(transcript.locator("[data-testid=bubble-learner]")).toHaveCount(2, {
      timeout: 10_000,
    });
    await expect(transcript.locator("[data-testid=bubble-tutor]")).toHaveCount(3, {
      timeout: 10_000,
    });

    await input.fill("done");
    await page.getByTestId("chat-send").click();

    // 5. Mark-complete notice appears and progress updates.
    await expect(page.getByTestId("lesson-complete")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("lesson-progress")).toContainText("1 / 3", {
      timeout: 10_000,
    });

    // 6. "Resume later" — close the browser context, reopen the home page,
    // and verify we land on the second lesson with the chat history intact.
    const ctx = page.context();
    await ctx.close();
    const fresh = await ctx.browser()!.newContext();
    const newPage = await fresh.newPage();
    await newPage.goto("/");
    await newPage.getByTestId("open-course-intro-to-llms").click();
    await expect(newPage).toHaveURL(/\/lessons\/tokens-and-context$/, { timeout: 15_000 });
    await expect(newPage.getByTestId("lesson-progress")).toContainText("1 / 3");

    // The second lesson should have its own opening tutor line and an empty
    // learner bubble at this point.
    const newTranscript = newPage.getByTestId("chat-transcript");
    await expect(newTranscript.locator("[data-testid=bubble-tutor]").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(newTranscript.locator("[data-testid=bubble-learner]")).toHaveCount(0);

    // 7. Drive the second lesson through to completion, proving chat works on
    // the resumed lesson and progress ticks forward.
    const newInput = newPage.getByTestId("chat-input");
    await newInput.fill("next");
    await newPage.getByTestId("chat-send").click();
    await expect(newTranscript.locator("[data-testid=bubble-learner]")).toHaveCount(1);
    await expect(newTranscript.locator("[data-testid=bubble-tutor]")).toHaveCount(2);

    await newInput.fill("three tokens");
    await newPage.getByTestId("chat-send").click();
    await expect(newTranscript.locator("[data-testid=bubble-learner]")).toHaveCount(2);

    await newInput.fill("done");
    await newPage.getByTestId("chat-send").click();
    await expect(newPage.getByTestId("lesson-progress")).toContainText("2 / 3", {
      timeout: 10_000,
    });

    // 8. The course view should reflect the new progress.
    await newPage.getByTestId("back-to-course").click();
    await expect(newPage).toHaveURL(/\/courses\/intro-to-llms$/);
    await expect(newPage.getByTestId("progress-count")).toContainText("2 / 3");
  });
});