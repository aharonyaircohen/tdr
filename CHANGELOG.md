# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- #21: Make lesson transcripts learner-owned without losing demo history — `Message.learnerId` is now required (no schema default), every read/write path in `service.ts` and the seed endpoint scopes by `getCurrentLearnerId()`, the per-learner seed idempotency key prevents cross-learner collisions, dev reset wipes everything and pre-seeds openings for the current learner only, and a `scripts/backfill-learner-ownership.mjs` upgrade step preserves every pre-#21 message id/content under `demo-learner`. `CURRENT_LEARNER_ID` remains a temporary identity source (no login).
- #19: Update cumulative proof for completed transcript and course activi… ([#20](https://github.com/aharonyaircohen/tdr/pull/20)) — @aharonyaircohen
- #17: Refresh course activity on every successful chat turn ([#18](https://github.com/aharonyaircohen/tdr/pull/18)) — @aharonyaircohen
- #15: Keep completed lesson transcripts stable after refresh ([#16](https://github.com/aharonyaircohen/tdr/pull/16)) — @aharonyaircohen
- #13: Document the current single-learner transcript boundary accurately ([#14](https://github.com/aharonyaircohen/tdr/pull/14)) — @aharonyaircohen
- #11: Enforce the existing sequential lesson path ([#12](https://github.com/aharonyaircohen/tdr/pull/12)) — @aharonyaircohen
- #11: Enforce the existing sequential lesson path — future lessons are locked on the course overview, a direct URL to a locked lesson redirects to the resume lesson in the same course, and the in-lesson Next lesson action appears only after the current lesson is complete (past completed lessons remain reviewable). `canEnterLesson` is the single policy owner.
- #9: Let learners recover from an incorrect chat answer ([#10](https://github.com/aharonyaircohen/tdr/pull/10)) — @aharonyaircohen
- #9: Let learners recover from an incorrect chat answer — wrong replies stay visible, the engine emits concise retry feedback that names the scripted learner prompt, and a later matching reply advances the lesson (refresh-safe)
- #7: Preserve learner progress across normal app restarts ([#8](https://github.com/aharonyaircohen/tdr/pull/8)) — @aharonyaircohen
- #7: Preserve learner progress across normal app restarts — non-destructive seed; `npm run db:reset` remains the only destructive path
- #5: Learner dashboard — continue learning across multiple courses ([#6](https://github.com/aharonyaircohen/tdr/pull/6)) — @aharonyaircohen
- #5: Learner dashboard — continue learning across multiple courses
- #3: Learner UI polish — fix stray bullet and replace oversized composer… ([#4](https://github.com/aharonyaircohen/tdr/pull/4)) — @aharonyaircohen
- #1: Vertical slice: chat-based LMS learner journey ([#2](https://github.com/aharonyaircohen/tdr/pull/2)) — @aharonyaircohen
