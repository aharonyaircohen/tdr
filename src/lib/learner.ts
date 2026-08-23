// Learner identity. The original slice used a single env-var fallback
// (`CURRENT_LEARNER_ID`) so vertical-slice tests and the two-learner
// isolation Playwright spec could exercise ownership without a login.
// Issue #23 layers real cookie-backed auth on top: when an HTTP request
// reads a valid session cookie (see src/lib/auth.ts) the cookie subject
// wins; otherwise the helper falls back to `CURRENT_LEARNER_ID` so the
// existing tests and dev convenience keep working unchanged.

import { cookies } from "next/headers";
import { verifySessionCookie, SESSION_COOKIE_NAME } from "./auth";

export const DEFAULT_LEARNER_ID = "demo-learner";

// Target learner id for legacy message backfill on pre-ownership databases.
// Any `Message` row whose `learnerId` was added by the upgrade script is
// owned by this learner, since the original schema had no learner field and
// all demo history was created under the single `demo-learner` identity.
export const LEGACY_MESSAGE_OWNER_ID = "demo-learner";

export type LearnerResolver = {
  cookie: string | null;
  envFallback: string | null;
};

let testResolver: LearnerResolver | null = null;

/**
 * Tests inject a deterministic learner id source here so unit tests don't
 * have to spin up an HTTP server. `cookie = null` with `envFallback` set
 * reproduces the historical env-var behaviour; a non-null `cookie`
 * replaces the env value entirely once verified.
 */
export function _setLearnerResolverForTests(
  resolver: LearnerResolver | null,
): void {
  testResolver = resolver;
}

export async function getCurrentLearnerId(): Promise<string> {
  if (testResolver) {
    if (testResolver.cookie !== null) {
      const verified = await verifySessionCookie(testResolver.cookie);
      if (verified) return verified;
    }
    if (testResolver.envFallback !== null) return testResolver.envFallback;
    return DEFAULT_LEARNER_ID;
  }
  let cookie: string | null = null;
  try {
    const jar = await cookies();
    cookie = jar.get(SESSION_COOKIE_NAME)?.value ?? null;
  } catch {
    // `cookies()` throws outside of a request scope (e.g. during build
    // prerender of static pages, or in unit tests). Fall back to the env
    // value so static paths and tests still resolve cleanly.
    cookie = null;
  }
  const verified = await verifySessionCookie(cookie);
  if (verified) return verified;
  return process.env.CURRENT_LEARNER_ID ?? DEFAULT_LEARNER_ID;
}

// Synchronous accessor preserved for the legacy service-layer callsites
// that haven't yet been migrated to the async cookie path. Prefer
// `getCurrentLearnerId` for any new code.
export function getCurrentLearnerIdSync(): string {
  return process.env.CURRENT_LEARNER_ID ?? DEFAULT_LEARNER_ID;
}