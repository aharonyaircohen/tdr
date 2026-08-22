# Vertical slice proof

This document captures the proof artifacts for issue #1 ("Vertical slice: chat-based LMS learner journey") on `aharonyaircohen/tdr`. All transcripts and screenshots below were captured against the real running app on 2026-08-22.

## 1. One-command fresh setup

From a clean checkout:

```bash
npm ci
npm run dev
# → http://localhost:3000
```

`npm run dev` runs `npm run setup` via the `predev` hook, which does
`prisma generate && prisma db push && tsx prisma/seed.ts`. The committed
`.env` provides `DATABASE_URL=file:./dev.db` and
`CURRENT_LEARNER_ID=demo-learner` so no manual setup is needed.

A real `npm install` against the committed lockfile completes in ~30s and
produces **0 critical** vulnerabilities (down from 2 critical in the
previous attempt; see audit notes below).

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
2. **`e2e`** — `npm ci` → `prisma generate` → `prisma db push` →
   `npm run build` → start the production server (with `ALLOW_DEV_RESET=true`)
   → `npm run test:e2e`. Uploads `playwright-report/` and the server log as
   artifacts.

The passing CI run URL for the vertical-slice PR will be linked from the PR
description.

## 6. Audit fixes from the prior PR

| Issue found in prior PR | Fix |
|---|---|
| Missing `.github/workflows/ci.yml` | New workflow created (`lint-typecheck-unit` + `e2e` jobs). |
| Proof called nonexistent `/api/courses` routes | Added `src/app/api/courses/route.ts` and `src/app/api/courses/[slug]/route.ts`; transcript and screenshots reference them. |
| `npm run dev` was not a one-command setup | Added committed `.env`, `setup` script, and `predev` hook so `npm ci && npm run dev` is sufficient. |
| 13 npm vulnerabilities (2 critical, vulnerable Next) | Upgraded Next 14.2.18 → 14.2.35, Vitest 2.1.3 → 3.2.7, Playwright 1.48.2 → 1.62.1. `npm audit` now reports 0 critical. |
| Proof had no real screenshots | 7 real PNGs in `docs/screenshots/`, captured against the running app. |
| E2E stopped at 2/3 lessons | E2E extended to drive lesson 3 to completion and assert `3 / 3`. |
| `tsconfig.tsbuildinfo` committed | File removed; `tsconfig.tsbuildinfo` added to `.gitignore`. |

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
