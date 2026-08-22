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

  test("open → chat → progress → resume after reload → 3/3 complete", async ({
    page,
  }) => {
    // 1. Open the app and pick the seeded course.
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /The Digital Reality/i }),
    ).toBeVisible();
    await page.getByTestId("open-course-intro-to-llms").click();

    // The course view should auto-redirect into the first lesson.
    await expect(page).toHaveURL(
      /\/courses\/intro-to-llms\/lessons\/what-is-llm$/,
    );

    // 2. See lesson progress: 0 / 3 to start.
    await expect(page.getByTestId("lesson-progress")).toContainText("0 / 3");

    // 3. Wait for the opening tutor turn.
    const tutor = page.getByTestId("bubble-tutor");
    await expect(tutor.first()).toBeVisible({ timeout: 15_000 });

    const transcript = page.getByTestId("chat-transcript");
    const input = page.getByTestId("chat-input");

    // ---------- Lesson 1: what-is-llm ----------
    await input.fill("next");
    await page.getByTestId("chat-send").click();
    await expect(transcript.locator("[data-testid=bubble-learner]")).toHaveCount(
      1,
      { timeout: 10_000 },
    );
    await expect(transcript.locator("[data-testid=bubble-tutor]")).toHaveCount(
      2,
      { timeout: 10_000 },
    );

    await input.fill("I've heard about them on podcasts.");
    await page.getByTestId("chat-send").click();
    await expect(transcript.locator("[data-testid=bubble-learner]")).toHaveCount(
      2,
      { timeout: 10_000 },
    );
    await expect(transcript.locator("[data-testid=bubble-tutor]")).toHaveCount(
      3,
      { timeout: 10_000 },
    );

    await input.fill("done");
    await page.getByTestId("chat-send").click();
    await expect(page.getByTestId("lesson-complete")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("lesson-progress")).toContainText("1 / 3", {
      timeout: 10_000,
    });

    // ---------- "Resume later": close + reopen in a fresh context ----------
    const ctx = page.context();
    await ctx.close();
    const fresh = await ctx.browser()!.newContext();
    const newPage = await fresh.newPage();
    await newPage.goto("/");
    await newPage.getByTestId("open-course-intro-to-llms").click();
    await expect(newPage).toHaveURL(/\/lessons\/tokens-and-context$/, {
      timeout: 15_000,
    });
    await expect(newPage.getByTestId("lesson-progress")).toContainText("1 / 3");

    const newTranscript = newPage.getByTestId("chat-transcript");
    await expect(
      newTranscript.locator("[data-testid=bubble-tutor]").first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      newTranscript.locator("[data-testid=bubble-learner]"),
    ).toHaveCount(0);

    // ---------- Lesson 2: tokens-and-context ----------
    const newInput = newPage.getByTestId("chat-input");
    await newInput.fill("next");
    await newPage.getByTestId("chat-send").click();
    await expect(
      newTranscript.locator("[data-testid=bubble-learner]"),
    ).toHaveCount(1);
    await expect(
      newTranscript.locator("[data-testid=bubble-tutor]"),
    ).toHaveCount(2);

    await newInput.fill("three tokens");
    await newPage.getByTestId("chat-send").click();
    await expect(
      newTranscript.locator("[data-testid=bubble-learner]"),
    ).toHaveCount(2);
    await expect(
      newTranscript.locator("[data-testid=bubble-tutor]"),
    ).toHaveCount(3);

    await newInput.fill("done");
    await newPage.getByTestId("chat-send").click();
    await expect(newPage.getByTestId("lesson-progress")).toContainText(
      "2 / 3",
      { timeout: 10_000 },
    );

    // ---------- Lesson 3: prompts-are-programs ----------
    // Navigate via the lesson page's "Next lesson" link to exercise nav.
    await newPage.getByTestId("next-lesson").click();
    await expect(newPage).toHaveURL(
      /\/lessons\/prompts-are-programs$/,
      { timeout: 15_000 },
    );
    await expect(newPage.getByTestId("lesson-progress")).toContainText("2 / 3");

    const thirdTranscript = newPage.getByTestId("chat-transcript");
    await expect(
      thirdTranscript.locator("[data-testid=bubble-tutor]").first(),
    ).toBeVisible({ timeout: 15_000 });

    const thirdInput = newPage.getByTestId("chat-input");
    await thirdInput.fill("next");
    await newPage.getByTestId("chat-send").click();
    await expect(
      thirdTranscript.locator("[data-testid=bubble-learner]"),
    ).toHaveCount(1);

    await thirdInput.fill("clear intent");
    await newPage.getByTestId("chat-send").click();
    await expect(
      thirdTranscript.locator("[data-testid=bubble-learner]"),
    ).toHaveCount(2);

    await thirdInput.fill("done");
    await newPage.getByTestId("chat-send").click();
    await expect(newPage.getByTestId("lesson-progress")).toContainText(
      "3 / 3",
      { timeout: 10_000 },
    );
    await expect(newPage.getByTestId("lesson-complete")).toBeVisible();

    // ---------- Course overview reflects final progress ----------
    await newPage.getByTestId("back-to-course").click();
    await expect(newPage).toHaveURL(/\/courses\/intro-to-llms$/);
    await expect(newPage.getByTestId("progress-count")).toContainText(
      "3 / 3",
    );
  });
});
