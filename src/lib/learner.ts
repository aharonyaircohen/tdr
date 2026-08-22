// For this vertical slice there is no auth — the current learner is a fixed env var.
// Kept behind a single helper so the slice can be swapped for real auth later.

export const DEFAULT_LEARNER_ID = "demo-learner";

export function getCurrentLearnerId(): string {
  return process.env.CURRENT_LEARNER_ID ?? DEFAULT_LEARNER_ID;
}