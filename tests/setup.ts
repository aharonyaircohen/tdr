// Vitest setup: load .env.test (or .env) so the test DB is isolated from dev.db.
import fs from "node:fs";
import path from "node:path";

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/i);
    if (!m) continue;
    const [, key, value] = m;
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const cwd = process.cwd();
loadEnv(path.resolve(cwd, ".env.test"));
loadEnv(path.resolve(cwd, ".env"));

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./test.db";
process.env.CURRENT_LEARNER_ID =
  process.env.CURRENT_LEARNER_ID ?? "test-learner";
process.env.NODE_ENV = "test";

// Provide a deterministic session secret for every test run so cookie-based
// identity assertions don't depend on filesystem state.
process.env.TDR_SESSION_SECRET = process.env.TDR_SESSION_SECRET
  ? process.env.TDR_SESSION_SECRET
  : "test-session-secret-please-rotate-in-real-deployments";

import {
  _setSessionSecretForTests,
  signSessionCookie,
} from "../src/lib/auth";
import {
  _setLearnerResolverForTests,
  type LearnerResolver,
} from "../src/lib/learner";

_setSessionSecretForTests(process.env.TDR_SESSION_SECRET!);

/**
 * Test helper: install a cookie-backed identity resolver for the current
 * test. The next call to `getCurrentLearnerId()` will return `learnerId`.
 * Pass `null` to clear the resolver and restore env-var fallback.
 */
export async function signInAs(learnerId: string): Promise<void> {
  const cookie = await signSessionCookie(learnerId);
  _setLearnerResolverForTests({
    cookie,
    envFallback: null,
  } satisfies LearnerResolver);
}

export function signInAsEnv(learnerId: string): void {
  _setLearnerResolverForTests({
    cookie: null,
    envFallback: learnerId,
  });
}

export function resetAuth(): void {
  _setLearnerResolverForTests(null);
}

declare module "vitest" {
  interface VitestGlobalSetup {
    signInAs?: typeof signInAs;
    signInAsEnv?: typeof signInAsEnv;
    resetAuth?: typeof resetAuth;
  }
}