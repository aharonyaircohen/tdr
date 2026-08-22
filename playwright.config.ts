import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const port = new URL(baseURL).port || "3000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: {
    command: `ALLOW_DEV_RESET=true npm run dev -- -p ${port}`,
    url: baseURL,
    // Reusing an arbitrary server can silently test another checkout. A busy
    // port must fail loudly so every result proves this working tree.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Playwright owns the seeded dev server so the tested checkout is explicit.
});
