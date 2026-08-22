import { request } from "@playwright/test";

// Reset the dev database before the e2e suite runs so the journey starts
// from a clean state. Hits the dev-only reset endpoint. The server must
// have been started with ALLOW_DEV_RESET=true.
export default async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post("/api/dev/reset");
  if (!res.ok()) {
    throw new Error(
      `Failed to reset dev DB (${res.status()}): ${await res.text()}. ` +
        `Is the server running with ALLOW_DEV_RESET=true?`,
    );
  }
  await ctx.dispose();
}