# Vertical slice proof

This document captures the proof artifacts for issue #1 ("Vertical slice: chat-based LMS learner journey") on `aharonyaircohen/tdr`. All transcripts and screenshots below were captured against the real running app on 2026-08-22 against commit on the `1-vertical-slice-chat-based-lms-learner-journey` branch.

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
so no `.env` file is required.

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

## 4. How to reproduce these screenshots locally

```bash
npm ci
npm run dev               # in one terminal
# In another:
E2E_BASE_URL=http://127.0.0.1:3000 \
  npx tsx scripts/capture-proof.mts
ls docs/screenshots/
```

## 5. CI run

The CI workflow lives at `.github/workflows/ci.yml` and runs on every PR.
It runs two jobs:

1. **`lint-typecheck-unit`** — `npm ci` → `prisma generate` → `prisma db push`
   → `npm run typecheck` → `npm run lint` → `npm run test:unit`.
2. **`e2e`** — `npm ci` → `prisma generate` → `prisma db push` → seed the
   demo course → install Playwright browsers → `npm run build` → start the
   production server (with `ALLOW_DEV_RESET=true`) → `npm run test:e2e`.
   Uploads `playwright-report/`, `test-results/`, and the server log as
   artifacts.

The passing CI run URL for the vertical-slice PR will be linked from the PR
description.

## 6. Audit fixes from the prior PR

| Issue found in prior PR | Fix |
|---|---|
| Missing `.github/workflows/ci.yml` | New workflow created (`lint-typecheck-unit` + `e2e` jobs), committed and tracked. |
| `docs/screenshots/` was gitignored | Removed `docs/screenshots/` from `.gitignore`; seven real PNGs are now tracked. |
| `tsconfig.tsbuildinfo` committed | File removed from the index; `tsconfig.tsbuildinfo` stays in `.gitignore`. |
| Fresh `npm ci && npm run verify` skipped all four integration tests | Real cause was Next.js 16's async route params and a stale `dev.db` inode; both fixed. All four integration tests now run (no `.skip`) and pass. |
| npm audit reported 7 vulnerabilities, Vite peer conflict, deprecated ESLint 8 | Bumped Next 14.2.35 → 16.3.2, ESLint 8.57.1 → 9.39.5, eslint-config-next 14 → 16, @types/node 20.16.10 → 20.19.5, tsx 4.19.1 → 4.23.12. `npm audit` now reports `found 0 vulnerabilities`. Migrated `.eslintrc.json` → `eslint.config.mjs` (flat config). |
| `npm run dev` blocked by missing `.env` | npm scripts now inline `DATABASE_URL` and `CURRENT_LEARNER_ID`. |
| Next.js 16 blocked cross-origin dev requests | `allowedDevOrigins` + `serverActions.allowedOrigins` configured for `127.0.0.1:3000` and `localhost:3000`. |
| Next.js 15+ route `params` are Promises | Updated `courses/[slug]`, `courses/[slug]/lessons/[lessonSlug]`, and all `/api/lessons/[lessonId]` route handlers to `await params`. |
| Proof had no real screenshots | 7 real PNGs in `docs/screenshots/`, captured against the running app via `scripts/capture-proof.mts`. |
| E2E stopped at 2/3 lessons | E2E drives lesson 3 to completion and asserts `3 / 3`. |

## 7. Acceptance criteria map

| Criterion | Where it's covered |
|---|---|
| Stack chosen, justified, lockfile committed | `README.md`, `package-lock.json` |
| One-command local dev | `npm ci && npm run dev` |
| Seed script creates ≥ 1 course, ≥ 3 lessons, idempotent | `prisma/seed.ts` (upsert by slug, deletes orphan messages) |
| Learner can complete the full journey | `tests/e2e/learner-journey.spec.ts` + `docs/screenshots/` |
| Unit tests for chat turn endpoint + progress/resume | `tests/unit/script.test.ts`, `tests/unit/progress.test.ts`, `tests/integration/journey.test.ts` |
| E2E test drives full journey (all 3 lessons) | `tests/e2e/learner-journey.spec.ts` |
| CI workflow runs lint + typecheck + unit + e2e, green on the PR | `.github/workflows/ci.yml` |
| README + ARCHITECTURE explain data model + flows | `README.md`, `ARCHITECTURE.md` |
| This proof doc with dev command, HTTP transcript, screenshots | `docs/proof.md`, `docs/proof-http-transcript.txt`, `docs/screenshots/` |
