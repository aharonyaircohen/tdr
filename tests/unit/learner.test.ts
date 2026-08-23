// Unit tests for the resolver behaviour in src/lib/learner.ts. The
// function is async and reads cookies through next/headers, which throws
// outside of a request scope. We exercise the cookie, env-var, and default
// fallbacks using the test resolver installed by tests/setup.ts#signInAs.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_LEARNER_ID,
  getCurrentLearnerId,
  _setLearnerResolverForTests,
  type LearnerResolver,
} from "@/lib/learner";
import { signSessionCookie } from "@/lib/auth";

function reset(resolver: LearnerResolver | null = null): void {
  _setLearnerResolverForTests(resolver);
  delete process.env.CURRENT_LEARNER_ID;
}

describe("getCurrentLearnerId fallback chain", () => {
  beforeEach(() => {
    reset();
  });
  afterEach(() => {
    reset();
  });

  it("returns the DEFAULT_LEARNER_ID when no resolver and no env", async () => {
    reset(null);
    delete process.env.CURRENT_LEARNER_ID;
    expect(await getCurrentLearnerId()).toBe(DEFAULT_LEARNER_ID);
  });

  it("returns process.env.CURRENT_LEARNER_ID when no resolver and no cookie", async () => {
    reset(null);
    process.env.CURRENT_LEARNER_ID = "env-learner";
    expect(await getCurrentLearnerId()).toBe("env-learner");
  });

  it("returns the cookie subject when the test resolver carries a valid cookie", async () => {
    const cookie = await signSessionCookie("cookie-learner");
    reset({ cookie, envFallback: null });
    expect(await getCurrentLearnerId()).toBe("cookie-learner");
  });

  it("the cookie subject wins over envFallback", async () => {
    const cookie = await signSessionCookie("cookie-learner");
    reset({ cookie, envFallback: "env-learner" });
    process.env.CURRENT_LEARNER_ID = "env-learner";
    expect(await getCurrentLearnerId()).toBe("cookie-learner");
  });

  it("falls back to envFallback when the cookie is null", async () => {
    reset({ cookie: null, envFallback: "env-learner" });
    process.env.CURRENT_LEARNER_ID = "env-learner";
    expect(await getCurrentLearnerId()).toBe("env-learner");
  });

  it("falls back to envFallback when the cookie is malformed", async () => {
    reset({ cookie: "garbage", envFallback: "env-learner" });
    process.env.CURRENT_LEARNER_ID = "env-learner";
    expect(await getCurrentLearnerId()).toBe("env-learner");
  });

  it("falls back to DEFAULT_LEARNER_ID when both cookie and env are null", async () => {
    reset({ cookie: null, envFallback: null });
    delete process.env.CURRENT_LEARNER_ID;
    expect(await getCurrentLearnerId()).toBe(DEFAULT_LEARNER_ID);
  });
});