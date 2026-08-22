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
    await page.getByTestId("start-course-intro-to-llms").click();

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
    await newPage.getByTestId("continue-course-intro-to-llms").click();
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

  test("catalog has no stray bullet before the course card", async ({ page }) => {
    await page.goto("/");
    const list = page.getByTestId("course-list");
    await expect(list).toBeVisible();
    // The default <ul> would render a `•` marker via the ::marker pseudo.
    // list-style: none on the list (and inherited on items) means
    // getComputedStyle returns "none" for both the ul and its li children.
    const listStyle = await list.evaluate(
      (el) => getComputedStyle(el).listStyleType,
    );
    expect(listStyle).toBe("none");
    const firstItemStyle = await list
      .locator("li")
      .first()
      .evaluate((el) => getComputedStyle(el).listStyleType);
    expect(firstItemStyle).toBe("none");
    // No leading text/whitespace before the first <li>.
    const firstChild = await list.evaluate((el) => {
      const nodes = Array.from(el.childNodes).filter(
        (n) => n.nodeType !== Node.COMMENT_NODE,
      );
      return nodes[0]?.nodeName ?? null;
    });
    expect(firstChild).toBe("LI");
  });

  test("lesson composer is compact initially and grows as text is typed", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("start-course-intro-to-llms").click();
    await expect(page).toHaveURL(/\/lessons\/what-is-llm$/);
    await expect(page.getByTestId("bubble-tutor").first()).toBeVisible({
      timeout: 15_000,
    });

    const input = page.getByTestId("chat-input");

    // Initial height should be compact — well under the previous 56px minimum.
    const initialHeight = await input.evaluate((el) => el.getBoundingClientRect().height);
    expect(initialHeight).toBeGreaterThanOrEqual(36);
    expect(initialHeight).toBeLessThan(56);

    // Two lines of text — composer should grow.
    await input.fill("hello\nthere");
    const twoLineHeight = await input.evaluate((el) =>
      el.getBoundingClientRect().height,
    );
    expect(twoLineHeight).toBeGreaterThan(initialHeight + 8);

    // A very long reply (≈ 30 lines) should clamp at the max and scroll.
    const longText = Array.from(
      { length: 30 },
      (_, i) => `line ${i + 1}: word word word word word`,
    ).join("\n");
    await input.fill(longText);
    const longHeight = await input.evaluate((el) =>
      el.getBoundingClientRect().height,
    );
    expect(longHeight).toBeLessThanOrEqual(220);
    expect(longHeight).toBeGreaterThan(twoLineHeight);
    // The textarea should now be scrollable internally.
    const overflow = await input.evaluate((el) => getComputedStyle(el).overflowY);
    expect(overflow).toBe("auto");

    // Clearing the composer should collapse it back to the compact height.
    await input.fill("");
    const clearedHeight = await input.evaluate((el) =>
      el.getBoundingClientRect().height,
    );
    expect(clearedHeight).toBe(initialHeight);
  });

  test("chat is usable on a mobile viewport with no horizontal page scroll", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 667 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto("/");
    // The catalog must fit: no horizontal scrollbar on the page itself.
    await expect(
      page.getByRole("heading", { name: /The Digital Reality/i }),
    ).toBeVisible();
    await page.getByTestId("start-course-intro-to-llms").click();
    await expect(page).toHaveURL(/\/lessons\/what-is-llm$/, { timeout: 15_000 });
    await expect(page.getByTestId("bubble-tutor").first()).toBeVisible({
      timeout: 15_000,
    });

    const docOverflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(docOverflowX).toBeLessThanOrEqual(1);

    // Long bubble content should wrap, not overflow.
    await page.getByTestId("chat-input").fill("next");
    await page.getByTestId("chat-send").click();
    await expect(
      page.getByTestId("chat-transcript").locator("[data-testid=bubble-learner]"),
    ).toHaveCount(1, { timeout: 10_000 });
    await expect(
      page.getByTestId("chat-transcript").locator("[data-testid=bubble-tutor]"),
    ).toHaveCount(2, { timeout: 10_000 });

    await page.getByTestId("chat-input").fill(
      "I've heard about them on podcasts and read a couple of beginner articles, so I know a little about how they work but I would not call myself an expert.",
    );
    await page.getByTestId("chat-send").click();
    await expect(
      page.getByTestId("chat-transcript").locator("[data-testid=bubble-learner]"),
    ).toHaveCount(2, { timeout: 10_000 });

    const learnerBubble = page
      .getByTestId("chat-transcript")
      .locator("[data-testid=bubble-learner]")
      .last();
    const bubbleOverflows = await learnerBubble.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.right - window.innerWidth;
    });
    expect(bubbleOverflows).toBeLessThanOrEqual(1);
    await ctx.close();
  });
});

test.describe("Learner dashboard — multi-course", () => {
  test.beforeEach(async () => {
    const ctx = await request.newContext({
      baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    });
    const res = await ctx.post("/api/dev/reset");
    if (!res.ok()) {
      throw new Error(`reset failed: ${res.status()} ${await res.text()}`);
    }
    await ctx.dispose();
  });

  test("home shows both courses with independent state and a Continue card only when progress exists", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /The Digital Reality/i }),
    ).toBeVisible();
    // Before any progress: no Continue card, both courses Not started.
    await expect(page.getByTestId("continue-card")).toHaveCount(0);
    await expect(
      page.getByTestId("state-badge-intro-to-llms"),
    ).toHaveText("Not started");
    await expect(
      page.getByTestId("state-badge-prompting-patterns"),
    ).toHaveText("Not started");

    // Make one in-progress turn on course A.
    await page.getByTestId("start-course-intro-to-llms").click();
    await expect(page).toHaveURL(/\/lessons\/what-is-llm$/);
    await expect(page.getByTestId("bubble-tutor").first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("chat-input").fill("next");
    await page.getByTestId("chat-send").click();
    await expect(
      page.getByTestId("chat-transcript").locator("[data-testid=bubble-learner]"),
    ).toHaveCount(1, { timeout: 10_000 });
    await expect(
      page.getByTestId("chat-transcript").locator("[data-testid=bubble-tutor]"),
    ).toHaveCount(2, { timeout: 10_000 });

    // Return home — Continue card now appears, course A is in progress,
    // course B remains not started.
    await page.goto("/");
    await expect(page.getByTestId("continue-card")).toBeVisible();
    await expect(page.getByTestId("continue-card")).toContainText(
      "Intro to Large Language Models",
    );
    await expect(page.getByTestId("continue-progress-count")).toContainText(
      "0 / 3",
    );
    await expect(
      page.getByTestId("state-badge-intro-to-llms"),
    ).toHaveText("0 / 3 complete");
    await expect(
      page.getByTestId("state-badge-prompting-patterns"),
    ).toHaveText("Not started");
  });

  test("two independent courses → home summaries → close/reopen → correct resume target", async ({
    browser,
  }) => {
    // First context: drive course A partway, then start course B.
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto("/");

      // Start course A — make one in-progress turn on lesson 1.
      await page.getByTestId("start-course-intro-to-llms").click();
      await expect(page).toHaveURL(/\/lessons\/what-is-llm$/);
      await expect(page.getByTestId("bubble-tutor").first()).toBeVisible({
        timeout: 15_000,
      });
      await page.getByTestId("chat-input").fill("next");
      await page.getByTestId("chat-send").click();
      await expect(
        page
          .getByTestId("chat-transcript")
          .locator("[data-testid=bubble-learner]"),
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(
        page.getByTestId("chat-transcript").locator("[data-testid=bubble-tutor]"),
      ).toHaveCount(2, { timeout: 10_000 });

      // Go home and start course B — make one in-progress turn.
      await page.goto("/");
      // Continue card should still point at course A (most recent unfinished).
      await expect(page.getByTestId("continue-card")).toContainText(
        "Intro to Large Language Models",
      );
      await page.getByTestId("start-course-prompting-patterns").click();
      await expect(page).toHaveURL(/\/lessons\/role-and-audience$/);
      await expect(page.getByTestId("bubble-tutor").first()).toBeVisible({
        timeout: 15_000,
      });
      await page.getByTestId("chat-input").fill("next");
      await page.getByTestId("chat-send").click();
      await expect(
        page
          .getByTestId("chat-transcript")
          .locator("[data-testid=bubble-learner]"),
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(
        page.getByTestId("chat-transcript").locator("[data-testid=bubble-tutor]"),
      ).toHaveCount(2, { timeout: 10_000 });

      // Return home — Continue card must now point at course B (most recent).
      await page.goto("/");
      await expect(page.getByTestId("continue-card")).toContainText(
        "Prompting patterns for engineers",
      );
      // Both courses show independent in-progress state.
      await expect(
        page.getByTestId("state-badge-intro-to-llms"),
      ).toHaveText("0 / 3 complete");
      await expect(
        page.getByTestId("state-badge-prompting-patterns"),
      ).toHaveText("0 / 3 complete");

      await ctx.close();
    }

    // Second context: same learner — resume state must persist.
    const fresh = await browser.newContext();
    const page = await fresh.newPage();
    await page.goto("/");
    await expect(page.getByTestId("continue-card")).toBeVisible();
    await expect(page.getByTestId("continue-card")).toContainText(
      "Prompting patterns for engineers",
    );
    await expect(
      page.getByTestId("state-badge-intro-to-llms"),
    ).toHaveText("0 / 3 complete");
    await expect(
      page.getByTestId("state-badge-prompting-patterns"),
    ).toHaveText("0 / 3 complete");

    // Click the CTA — must land on course B's lesson 1 with prior transcript.
    await page.getByTestId("continue-cta").click();
    await expect(page).toHaveURL(/\/lessons\/role-and-audience$/, {
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("chat-transcript").locator("[data-testid=bubble-tutor]"),
    ).toHaveCount(2);
    await expect(
      page
        .getByTestId("chat-transcript")
        .locator("[data-testid=bubble-learner]"),
    ).toHaveCount(1);

    // Now go to course A — its transcript must be unchanged.
    await page.goto("/");
    await page.getByTestId("continue-course-intro-to-llms").click();
    await expect(page).toHaveURL(/\/lessons\/what-is-llm$/, { timeout: 15_000 });
    await expect(
      page
        .getByTestId("chat-transcript")
        .locator("[data-testid=bubble-tutor]"),
    ).toHaveCount(2); // opening + "Great. An LLM is trained ..."
    await expect(
      page
        .getByTestId("chat-transcript")
        .locator("[data-testid=bubble-learner]"),
    ).toHaveCount(1); // "next"

    await fresh.close();
  });
});

test.describe("Learner can recover from an incorrect chat answer", () => {
  test.beforeEach(async () => {
    const ctx = await request.newContext({
      baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    });
    const res = await ctx.post("/api/dev/reset");
    if (!res.ok()) {
      throw new Error(`reset failed: ${res.status()} ${await res.text()}`);
    }
    await ctx.dispose();
  });

  test("wrong → retry feedback → refresh → matching answer advances the lesson", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await page.getByTestId("start-course-intro-to-llms").click();
    await expect(page).toHaveURL(/\/lessons\/what-is-llm$/, { timeout: 15_000 });
    await expect(page.getByTestId("bubble-tutor").first()).toBeVisible({
      timeout: 15_000,
    });

    const transcript = page.getByTestId("chat-transcript");
    const input = page.getByTestId("chat-input");
    const send = page.getByTestId("chat-send");

    // 1. Send a wrong learner answer.
    await input.fill("watermelon");
    await send.click();
    await expect(transcript.locator("[data-testid=bubble-learner]")).toHaveCount(
      1,
      { timeout: 10_000 },
    );
    await expect(transcript.locator("[data-testid=bubble-tutor]")).toHaveCount(
      2,
      { timeout: 10_000 },
    );

    // The retry-feedback tutor bubble must include the scripted prompt so
    // the learner knows what to try again.
    const retryBubble = transcript.locator("[data-testid=bubble-tutor]").last();
    await expect(retryBubble).toBeVisible();
    await expect(retryBubble).toContainText("Try again");
    await expect(retryBubble).toContainText(
      "Learner indicates they are ready to continue",
    );
    // The wrong reply is still visible — not silently dropped.
    await expect(
      transcript.locator("[data-testid=bubble-learner]").first(),
    ).toHaveText("watermelon");
    // No lesson-complete banner — we are still on the same step.
    await expect(page.getByTestId("lesson-complete")).toHaveCount(0);

    // 2. Hard reload — simulates the learner closing/reopening the tab.
    await page.reload();
    const transcriptAfter = page.getByTestId("chat-transcript");
    await expect(
      transcriptAfter.locator("[data-testid=bubble-tutor]").first(),
    ).toBeVisible({ timeout: 15_000 });
    // The persisted transcript includes both the wrong turn and the retry
    // feedback; the lesson is still on the same scripted step.
    await expect(
      transcriptAfter.locator("[data-testid=bubble-learner]"),
    ).toHaveCount(1);
    await expect(
      transcriptAfter.locator("[data-testid=bubble-tutor]"),
    ).toHaveCount(2);
    await expect(
      transcriptAfter.locator("[data-testid=bubble-learner]").first(),
    ).toHaveText("watermelon");
    await expect(
      transcriptAfter.locator("[data-testid=bubble-tutor]").last(),
    ).toContainText("Try again");
    await expect(page.getByTestId("lesson-complete")).toHaveCount(0);

    // 3. Send the matching retry — the lesson must advance normally.
    const inputAfter = page.getByTestId("chat-input");
    const sendAfter = page.getByTestId("chat-send");
    await inputAfter.fill("next");
    await sendAfter.click();
    await expect(
      transcriptAfter.locator("[data-testid=bubble-learner]"),
    ).toHaveCount(2, { timeout: 10_000 });
    await expect(
      transcriptAfter.locator("[data-testid=bubble-tutor]"),
    ).toHaveCount(3, { timeout: 10_000 });
    // The new tutor line is the scripted advance, not another retry nudge.
    const advancedTutor = transcriptAfter
      .locator("[data-testid=bubble-tutor]")
      .last();
    await expect(advancedTutor).toBeVisible();
    await expect(advancedTutor).not.toContainText("Try again");

    // 4. Drive the rest of the lesson to prove recovery leads to the same
    // completion behavior as a clean walkthrough.
    await inputAfter.fill("I've heard about LLMs on podcasts.");
    await sendAfter.click();
    await expect(
      transcriptAfter.locator("[data-testid=bubble-learner]"),
    ).toHaveCount(3, { timeout: 10_000 });

    await inputAfter.fill("done");
    await sendAfter.click();
    await expect(page.getByTestId("lesson-complete")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("lesson-progress")).toContainText("1 / 3", {
      timeout: 10_000,
    });
    await context.close();
  });
});
