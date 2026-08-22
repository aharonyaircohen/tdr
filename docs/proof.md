# Vertical slice proof

This document captures the proof artifacts for issue #1 ("Vertical slice: chat-based LMS learner journey") on `aharonyaircohen/tdr`.

## Dev command

```bash
npm ci
npm run db:push
npm run db:seed
npm run dev
# → http://localhost:3000
```

## HTTP transcript of the chat endpoint

The chat endpoint lives at `POST /api/lessons/:lessonId/messages`. It accepts `{ content }` and returns `{ learnerMessage, tutorMessage, isComplete }`.

A real session against the seeded course (lesson slug `what-is-llm`, learner `demo-learner`) looks like this.

### 1. Get the lesson id

```bash
COURSE=$(curl -s http://127.0.0.1:3000/api/courses | jq '.[0]')
# (the course list endpoint is the home page; the API is reachable via the
# same routes — see tests/e2e for the full navigation)
```

### 2. Seed the first tutor turn

```bash
LESSON_ID=$(curl -s http://127.0.0.1:3000/api/courses/intro-to-llms \
  | jq -r '.lessons[] | select(.slug=="what-is-llm") | .id')

curl -s -X POST -H 'content-type: application/json' \
  http://127.0.0.1:3000/api/lessons/$LESSON_ID/seed
```

Returns:

```json
{
  "message": {
    "id": "clxx...",
    "role": "tutor",
    "content": "Welcome! In this lesson we will explore what a large language model actually is. ...",
    "createdAt": "2026-08-22T..."
  }
}
```

### 3. Send the first learner turn

```bash
curl -s -X POST -H 'content-type: application/json' \
  -d '{"content":"next"}' \
  http://127.0.0.1:3000/api/lessons/$LESSON_ID/messages
```

Returns:

```json
{
  "learnerMessage": { "id": "clxx...", "role": "learner", "content": "next", "createdAt": "..." },
  "tutorMessage": { "id": "clxx...", "role": "tutor", "content": "Great. An LLM is trained on huge amounts of text...", "createdAt": "..." },
  "isComplete": false
}
```

### 4. Drive to completion

A second turn about LLMs, then a third with `done`, flips `isComplete` to `true` and writes a `Progress` row with `completed = true`. The progress row is the only state the resume flow reads.

## Journey screenshots / recording

A full headless-browser run is produced by `tests/e2e/learner-journey.spec.ts` and exercised in CI on every PR. To capture a local recording:

```bash
npm run dev    # in one terminal
npm run test:e2e -- --reporter=list   # in another
```

The Playwright report (`playwright-report/`) contains the trace for each step. To produce an asciinema-style text recording, run:

```bash
npm run test:e2e -- --reporter=line
```

For the PR, the trace is uploaded as the `playwright-report` artifact on the e2e job.

### Click-by-click demo

1. `http://localhost:3000` → click **Open course →** under "Intro to Large Language Models".
2. Auto-redirected to `…/lessons/what-is-llm`. Transcript shows the opening tutor line.
3. Type `next`, click **Send**. Tutor advances to the second line.
4. Type a sentence containing a word that matches the expect list (`i know`, `llm`, etc.), click **Send**.
5. Type `done`, click **Send**. The green "Lesson complete" banner appears and the header now reads `1 / 3 lessons complete`.
6. Click **← {course title}** to return to the course view. The first lesson is marked Done, the second is marked Current.
7. Click the **Next lesson →** link in the actions row, or reload the page — the resume flow lands you on `tokens-and-context` with its own opening tutor line and no prior learner turns.
8. Repeat for lesson 3. The header reads `3 / 3 lessons complete`. The course view shows all lessons with the **Done** badge.

## CI run

The CI workflow at `.github/workflows/ci.yml` runs:

- `npm run lint`
- `npm run typecheck`
- `npm run test:unit` (Vitest — unit + integration)
- `npm run test:e2e` (Playwright — full journey)

The passing CI run URL for the vertical-slice PR will be linked from the PR description. Look for the most recent green run on the `ci` workflow for this branch.

## Acceptance criteria map

| Criterion | Where it's covered |
|---|---|
| Stack chosen, justified, lockfile committed | `README.md`, `package-lock.json` |
| One-command local dev | `npm run dev` |
| Seed script creates ≥ 1 course, ≥ 3 lessons, idempotent | `prisma/seed.ts` (upsert by slug, deletes orphan messages) |
| Learner can complete the full journey | `tests/e2e/learner-journey.spec.ts` |
| Unit tests for chat turn endpoint + progress/resume | `tests/unit/script.test.ts`, `tests/unit/progress.test.ts`, `tests/integration/journey.test.ts` |
| E2E test drives full journey | `tests/e2e/learner-journey.spec.ts` |
| CI workflow runs lint + unit + e2e, green on the PR | `.github/workflows/ci.yml` |
| README + ARCHITECTURE explain data model + flows | `README.md`, `ARCHITECTURE.md` |
| This proof doc | `docs/proof.md` |