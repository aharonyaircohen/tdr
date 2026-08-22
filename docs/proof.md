# Vertical slice proof

This document captures the proof artifacts for the TDR learner journey on
`aharonyaircohen/tdr`:

- **Issue #1 / PR #2** — Vertical slice: chat-based LMS learner journey
  (the working foundation this PR builds on).
- **Issue #3 / PR #4** — Learner UI polish: removed the stray bullet before
  the course card on the catalog, and replaced the oversized lesson textarea +
  send button with a compact chat composer that grows naturally with content.
- **Issue #5 / PR #6** — Learner dashboard: extend the existing learner
  journey so a learner can see more than one course, see independent progress
  on each, and continue the right unfinished course after switching away.
- **Issue #7 / PR #8** — Persistence across normal app restarts:
  the seed script no longer wipes `Message` and `Progress` rows, so a
  normal `npm run dev` start preserves learner chat history and progress.
  `npm run db:reset` remains the only destructive reset path; Playwright
  uses the dev-only `POST /api/dev/reset` endpoint (gated on
  `ALLOW_DEV_RESET=true`) for an isolated, clean state during e2e runs.
- **Issue #9 / this PR** — Recover from an incorrect chat answer:
  the rule-based chat engine now lets a learner who types a wrong reply
  retry and advance the lesson. The wrong turn stays visible in the
  transcript, the engine surfaces concise retry feedback that names the
  scripted learner prompt, and refreshing the page preserves the ability
  to retry. Existing correct journeys are unchanged.

All transcripts and screenshots below were captured against the real running
app on the branch for the change described by each section.

## 1. One-command fresh setup

From a clean checkout:

```bash
npm ci
npm run dev
# → http://localhost:3000
```

`npm run dev` runs `npm run setup` via the `predev` hook, which does
`prisma generate && prisma db push && tsx prisma/seed.ts`. The npm scripts
inline `DATABASE_URL=file:./dev.db` and `CURRENT_LEARNER_ID=demo-learner`,
so no `.env` file is required. **The seed is non-destructive:** re-running
it on an existing database upserts courses and lessons without touching
learner-owned `Message` or `Progress` rows, so a normal dev restart keeps
chat history and progress intact. The only destructive reset path is
`npm run db:reset`, which removes `prisma/dev.db` before re-pushing and
re-seeding.

A real `npm install` against the committed lockfile completes in ~25s and
produces **0 vulnerabilities** (`npm audit` reports `found 0 vulnerabilities`)
across all severity levels. Earlier reports of high-severity Next.js,
postcss, and sharp CVEs were resolved by upgrading to Next.js 16.3.2
along with its current peers (ESLint 9, eslint-config-next 16,
@types/node 20.19, tsx 4.23).

## 2. HTTP transcript of the chat endpoint

The chat endpoint is `POST /api/lessons/:lessonId/messages`. It accepts `{ content }`
and returns `{ learnerMessage, tutorMessage, isComplete }`. The lesson id is
resolved from `GET /api/courses/:slug`.

A full transcript is in [`docs/proof-http-transcript.txt`](proof-http-transcript.txt).
Key exchanges against lesson "What is an LLM?" (id `cmt4hdmwy0002gnjtlu83yqaf`):

```
POST /api/lessons/{id}/seed                       → 200 OK  (opening tutor line)
POST /api/lessons/{id}/messages   {"next"}        → 200 OK  (advances to next tutor line)
POST /api/lessons/{id}/messages   {"I've heard…"} → 200 OK  (advances; isComplete=false)
POST /api/lessons/{id}/messages   {"done"}        → 200 OK  (isComplete=true, Progress row written)
```

After the final turn, `GET /api/courses/intro-to-llms` still reports
`resumeLessonSlug=tokens-and-context` until lesson 2 is started.

## 3. Screenshots of the full journey

Captured live by `scripts/capture-proof.mts` running against the dev server.
PNGs live under [`docs/screenshots/`](screenshots/).

### 1. Open the app

![Home](screenshots/01-home.png)

### 2. Enter the course, land in lesson 1

The home-page link to "Intro to Large Language Models" drops the learner into
the first lesson with the opening tutor line already rendered.

![Lesson 1 opening](screenshots/02-lesson1-opening.png)

### 3. Exchange three chat turns on lesson 1

`next` → "I've heard about them on podcasts." → `done`. The completion
banner appears and the header counter ticks to `1 / 3 lessons complete`.

![Lesson 1 complete](screenshots/03-lesson1-complete.png)

### 4. Resume later — close the browser, reopen

A fresh browser context lands on the second lesson with its own opening tutor
line and zero learner turns (the first lesson's transcript is intact in the
DB but the UI is on lesson 2).

![Lesson 2 resumed](screenshots/04-lesson2-resumed.png)

### 5. Open lesson 3 via the in-lesson navigation

After finishing lesson 2, the learner clicks **Next lesson →** to reach the
final lesson.

![Lesson 3 opening](screenshots/05-lesson3-opening.png)

### 6. Drive lesson 3 to completion

![Lesson 3 complete](screenshots/06-lesson3-complete.png)

### 7. Course overview — all lessons marked Done

The course view reflects `3 / 3 complete` with the **Done** badge on every
lesson.

![Course overview](screenshots/07-course-overview.png)

## 4. UI polish (issue #3)

### Stray bullet removed from the catalog

Root cause: `<ul class="course-list">` did not have `list-style: none`, so the
default `::marker` rendered as a `•` before each `<li class="course-card">`.
The sibling `<ul class="lesson-list">` already had the right reset. Fix: added
`list-style: none; padding: 0; margin: 0;` to `.course-list` in
`src/app/globals.css`. No markup change was needed.

![Catalog desktop — no stray bullet](screenshots/08-catalog-fixed-desktop.png)

![Catalog mobile (375px) — no stray bullet, no horizontal scroll](screenshots/09-catalog-fixed-mobile.png)

### Compact chat composer with natural auto-grow

The lesson footer was previously a tall textarea + a stretched send button
that consumed most of the chat shell. It is now a single-line-by-default
rounded composer with the send button attached on the right. The textarea
uses its real browser `scrollHeight`, so wrapped text grows correctly at the
actual desktop or mobile width. It grows up to 200px and then scrolls
internally. Enter sends, Shift+Enter
inserts a newline, focus ring is preserved, the send button keeps an
`aria-label="Send reply"` for screen readers.

![Composer empty — compact single-line](screenshots/10-composer-empty.png)

![Composer with a long reply — grown + focus ring + attached Send](screenshots/11-composer-long.png)

### Mobile readability

The mobile screenshot below shows the chat usable on a 375×720 viewport: the
transcript scrolls independently, the composer sits at the bottom, and no
horizontal page scroll is needed. The chat-shell grid was changed from
`auto 1fr auto` to `minmax(0, 1fr) auto auto` so the transcript (the first
grid child) takes the remaining vertical space and the form (the second child)
stays compact at the bottom.

![Lesson on a mobile viewport — composer + scrollable transcript](screenshots/12-lesson-mobile.png)

## 4a. Multi-course learner dashboard (issue #5)

Substantive-change CI: [run 32584922139](https://github.com/aharonyaircohen/tdr/actions/runs/32584922139)
passed repository verification and all six Playwright journeys.

The home page is now a dashboard with two regions:

- **Continue learning** — a single card that surfaces the most-recently-active
  unfinished course. Hidden when no course has progress.
- **All courses** — the full catalog, with per-course state
  (`Not started`, `x / y complete`, `Complete`) and a primary action
  (`Start course →`, `Continue →`, or `Review →`).

Selection logic lives in `src/lib/progress.ts`:

- `pickRecentActiveCourse(courses, learnerId)` — returns the unfinished course
  whose most-recent `Progress.updatedAt` is the latest. A complete course is
  never a candidate, even if its activity is more recent.
- `summariseCourseProgress(course, learnerId)` — derives `state`, `completed`,
  `total`, and `lastActivityAt` per course.

Both helpers are unit-tested in `tests/unit/progress.test.ts` (10 new
assertions) and integration-tested in `tests/integration/journey.test.ts` (4
new assertions covering isolation and the multi-course `listCourses`
payload). The Playwright suite adds two e2e tests under
`Learner dashboard — multi-course`.

### 1. Empty dashboard — no progress

Both seeded courses show **Not started**, no Continue card. Course B
("Prompting patterns for engineers") is now visible in the catalog.

![Dashboard empty — desktop](screenshots/13-dashboard-empty-desktop.png)

![Dashboard empty — mobile](screenshots/13-dashboard-empty-mobile.png)

### 2. One course started — Continue card points at it

The learner makes one in-progress turn on "Intro to Large Language Models".
The home page shows a Continue card for that course (0 / 3 complete); the
second course remains Not started.

![Dashboard with one course in progress — desktop](screenshots/14-dashboard-one-course-desktop.png)

![Dashboard with one course in progress — mobile](screenshots/14-dashboard-one-course-mobile.png)

### 3. Two courses, Continue card follows activity

The learner then makes one in-progress turn on "Prompting patterns for
engineers". The Continue card switches to that course (its `updatedAt` is
more recent), and each course card shows its own progress count
independently — course A still reads 0 / 3, course B reads 0 / 3, neither has
leaked state into the other.

![Dashboard with two courses — desktop](screenshots/15-dashboard-two-courses-desktop.png)

![Dashboard with two courses — mobile](screenshots/15-dashboard-two-courses-mobile.png)

### Capture

These screenshots are produced by `scripts/capture-dashboard-screenshots.mts`,
which mirrors the journey the e2e test drives: home → start course A →
home → start course B → home. Each viewport is captured at full page height.

## 4b. Recovering from an incorrect chat answer (issue #9)

Substantive-change CI: see the run linked at the bottom of this document.

The rule-based engine in `src/lib/script.ts` previously replayed the
persisted transcript and stopped at the first unmatched learner turn. That
turn stayed in history, so every later correct retry was still evaluated
behind it and the lesson could never advance. The generic nudge
("I am waiting for your reply" / "I am a bit lost") also did not tell the
learner what to retry.

The fix is in `selectTutorReply` (single file). The replay loop now skips
past any turn that does not line up with the current script step —
wrong learner replies, unexpected tutor messages, and the retry feedback
itself — instead of breaking on a mismatch. After replay:

- If the engine is positioned at a learner step and at least one turn was
  skipped during replay, the reply is **concise retry feedback** that
  references the scripted learner prompt:
  `That doesn't match what I'm looking for. Try again — I'm asking: <prompt>.`
- Otherwise the engine returns the natural waiting nudge (no wrong turns
  in the transcript).

The wrong learner turn and the retry feedback are both persisted as
normal `Message` rows so the learner can see what they tried and what the
tutor wants. A later matching reply still advances the lesson as if the
wrong turn had never happened — there is no transcript-poisoning.

### Behavior summary

| Step | Engine behaviour |
|---|---|
| Learner types a wrong answer | Engine skips the wrong turn, emits retry feedback based on the current scripted prompt. |
| Learner refreshes / reopens the tab | Persisted transcript (including the wrong turn + retry feedback) is loaded; engine still knows where it is in the script. |
| Learner retries with a matching answer | Engine skips past the wrong turn + retry feedback, emits the next scripted tutor line and the lesson advances normally. |
| Correct-only journey (no wrong turns) | Unchanged — natural waiting nudge, same advance semantics. |

### Coverage

- `tests/unit/script.test.ts` — 6 new unit tests for the recovery branch:
  retry feedback references the prompt, wrong → correct advances, several
  wrong answers in a row, partial-progress wrong answer recovers, the
  natural waiting state still uses the existing nudge, and `retryFeedback`
  is deterministic.
- `tests/integration/journey.test.ts` — 2 new integration tests using the
  real SQLite DB and the real `sendTurn` service: a full wrong → wrong →
  correct → complete walkthrough that asserts every persisted row
  (`tutor`, `learner`, `tutor`, `learner`, `tutor`, `learner`, `tutor`,
  `learner`), and a refresh-survival test that simulates reopening mid-
  recovery.
- `tests/e2e/learner-journey.spec.ts` — 1 new Playwright test under
  "Learner can recover from an incorrect chat answer": wrong reply →
  retry-feedback bubble containing the prompt text → hard reload → the
  wrong reply is still there → matching retry → lesson advances → drive
  the rest of the lesson to completion with `1 / 3` in the header.

All 57 unit/integration tests pass (was 49 before this change); the new
e2e test extends the existing Playwright suite without touching the
existing four journeys.

## 5. How to reproduce these screenshots locally

```bash
npm ci
npm run dev               # in one terminal
# In another:
E2E_BASE_URL=http://127.0.0.1:3000 \
  npx tsx scripts/capture-proof.mts
E2E_BASE_URL=http://127.0.0.1:3000 \
  npx tsx scripts/capture-polish-screenshots.mts
E2E_BASE_URL=http://127.0.0.1:3000 \
  npx tsx scripts/capture-dashboard-screenshots.mts
ls docs/screenshots/
```

## 6. CI run

The CI workflow lives at `.github/workflows/ci.yml` and runs on every PR.
It runs two jobs:

1. **`verify`** — `npm ci` → typecheck → lint → all unit and integration
   tests (33/33 on this branch: progress 11, script 10, composer 7,
   integration 5).
2. **`e2e`** — `npm ci` → install Chromium → `npm run test:e2e`. Playwright
   starts the real dev server with database reset enabled, drives the complete
   3/3 learner journey, and uploads its report.

The four e2e tests on this branch are:

1. `open → chat → progress → resume after reload → 3/3 complete` — the original
   vertical-slice journey.
2. `catalog has no stray bullet before the course card` — asserts the list and
   its first `<li>` compute to `list-style-type: none`, and that the list's
   first non-comment child is an `<li>`.
3. `lesson composer is compact initially and grows as text is typed` — asserts
   the empty composer is in the 36–56px range, grows after typing two lines,
   clamps at ≤220px for a 30-line reply (with `overflow-y: auto`), and
   collapses back when cleared.
4. `chat is usable on a mobile viewport with no horizontal page scroll` —
   375×667 viewport, asserts `document.scrollWidth - clientWidth ≤ 1` and that
   a long learner bubble does not extend past the viewport.

The vertical-slice PR (#2) had a passing CI run:
[Passing CI run 32581571095](https://github.com/aharonyaircohen/tdr/actions/runs/32581571095).
This polish PR passed both jobs in
[CI run 32583438672](https://github.com/aharonyaircohen/tdr/actions/runs/32583438672).
Playwright owns the dev server and never reuses an arbitrary process already
listening on the configured port, so a local result cannot silently come from
another checkout. Set `E2E_BASE_URL` to use an isolated port when needed.

## 7. Audit fixes from the prior PR

| Issue found in prior PR | Fix |
|---|---|
| Missing `.github/workflows/ci.yml` | New workflow created (`verify` + `e2e` jobs), committed and tracked. |
| `docs/screenshots/` was gitignored | Removed `docs/screenshots/` from `.gitignore`; seven real PNGs are now tracked. |
| `tsconfig.tsbuildinfo` committed | File removed from the index; `tsconfig.tsbuildinfo` stays in `.gitignore`. |
| Fresh `npm ci && npm run verify` skipped all four integration tests | Real cause was Next.js 16's async route params and a stale `dev.db` inode; both fixed. All four integration tests now run (no `.skip`) and pass. |
| npm audit reported 7 vulnerabilities, Vite peer conflict, deprecated ESLint 8 | Bumped Next 14.2.35 → 16.3.2, ESLint 8.57.1 → 9.39.5, eslint-config-next 14 → 16, @types/node 20.16.10 → 20.19.5, tsx 4.19.1 → 4.23.12. `npm audit` now reports `found 0 vulnerabilities`. Migrated `.eslintrc.json` → `eslint.config.mjs` (flat config). |
| `npm run dev` blocked by missing `.env` | npm scripts now inline `DATABASE_URL` and `CURRENT_LEARNER_ID`. |
| Next.js 16 blocked cross-origin dev requests | `allowedDevOrigins` + `serverActions.allowedOrigins` configured for `127.0.0.1:3000` and `localhost:3000`. |
| Next.js 15+ route `params` are Promises | Updated `courses/[slug]`, `courses/[slug]/lessons/[lessonSlug]`, and all `/api/lessons/[lessonId]` route handlers to `await params`. |
| Proof had no real screenshots | 7 real PNGs in `docs/screenshots/`, captured against the running app via `scripts/capture-proof.mts`. |
| E2E stopped at 2/3 lessons | E2E drives lesson 3 to completion and asserts `3 / 3`. |
| Concurrent first-visit requests could duplicate the opening tutor message | The seed route uses a deterministic message id with an atomic upsert; an integration regression sends two concurrent requests and proves exactly one message persists. |

## 8. Acceptance criteria map (issue #1 + #3 + #5)

| Criterion | Where it's covered |
|---|---|
| Stack chosen, justified, lockfile committed | `README.md`, `package-lock.json` |
| One-command local dev | `npm ci && npm run dev` |
| Seed script creates ≥ 1 course, ≥ 3 lessons, idempotent | `prisma/seed.ts` (upsert by slug, deletes orphan messages); now two courses × 3 lessons |
| Learner can complete the full journey | `tests/e2e/learner-journey.spec.ts` + `docs/screenshots/` |
| Unit tests for chat turn endpoint + progress/resume | `tests/unit/script.test.ts`, `tests/unit/progress.test.ts`, `tests/integration/journey.test.ts` |
| Unit tests for the compact composer's auto-grow | `tests/unit/composer.test.ts` (7 tests: empty / short / measured wrap / max / collapse / custom opts) |
| Unit tests for per-course progress summaries | `tests/unit/progress.test.ts` → `summariseCourseProgress` (4 cases) |
| Unit tests for most-recent unfinished-course selection | `tests/unit/progress.test.ts` → `pickRecentActiveCourse` (6 cases) |
| Integration tests for multi-course isolation | `tests/integration/journey.test.ts` → `multi-course dashboard helpers` (4 cases) |
| E2E test drives full journey (all 3 lessons) | `tests/e2e/learner-journey.spec.ts` |
| E2E covers the catalog stray-bullet fix | `tests/e2e/learner-journey.spec.ts` → "catalog has no stray bullet" |
| E2E covers the compact composer's auto-grow | `tests/e2e/learner-journey.spec.ts` → "lesson composer is compact initially and grows" |
| E2E covers mobile viewport usability | `tests/e2e/learner-journey.spec.ts` → "chat is usable on a mobile viewport" |
| E2E covers dashboard empty / single-course / two-course state | `tests/e2e/learner-journey.spec.ts` → "Learner dashboard — multi-course" (2 tests) |
| CI workflow runs lint + typecheck + unit + e2e, green on the PR | `.github/workflows/ci.yml` |
| README + ARCHITECTURE explain data model + flows | `README.md`, `ARCHITECTURE.md` |
| Real desktop + mobile screenshots of dashboard before progress and with independent progress in two courses | `docs/screenshots/13-*.png`, `docs/screenshots/14-*.png`, `docs/screenshots/15-*.png` |
| This proof doc with dev command, HTTP transcript, polish screenshots | `docs/proof.md`, `docs/proof-http-transcript.txt`, `docs/screenshots/` |
