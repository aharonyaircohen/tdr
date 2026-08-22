// For this vertical slice there is no auth — the current learner is a fixed env var.
// Kept behind a single helper so the slice can be swapped for real auth later.
// `CURRENT_LEARNER_ID` is a temporary identity source, NOT a login: there is no
// password, no session, and no per-request verification. Every code path that
// writes a `Message` row resolves its owner through `getCurrentLearnerId()`.

export const DEFAULT_LEARNER_ID = "demo-learner";

// Target learner id for legacy message backfill on pre-ownership databases.
// Any `Message` row whose `learnerId` was added by the upgrade script is
// owned by this learner, since the original schema had no learner field and
// all demo history was created under the single `demo-learner` identity.
export const LEGACY_MESSAGE_OWNER_ID = "demo-learner";

export function getCurrentLearnerId(): string {
  return process.env.CURRENT_LEARNER_ID ?? DEFAULT_LEARNER_ID;
}