# The Digital Reality (TDR)

A chat-based learning management system. This repository is the **vertical slice**: a learner dashboard that lets a learner browse multiple courses, see independent progress on each, and continue the right unfinished lesson — all chat-based, against a running app.

## What you can do

1. Open the app at `http://localhost:3000`.
2. See the home dashboard with a **Continue learning** card (only when progress exists) and an **All courses** catalog.
3. Pick one of the seeded courses ("Intro to Large Language Models" or "Prompting patterns for engineers").
4. Chat with the tutor through the lesson script. Each tutor message advances the lesson; the lesson is marked complete when the script finishes.
5. Start a second course — its progress stays isolated on its own card.
6. Return home and the Continue card jumps to whichever unfinished course was touched most recently (a course that is fully complete never replaces a still-active one).
7. Close the browser. Reopen the app. You land back on the most-recent unfinished lesson, with all prior chat history restored for every course.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 16 (App Router) + TypeScript** | One framework covers server (API routes, server components) and client (React). Strongly typed end-to-end. Single `next dev` command for development and `next build`/`next start` for production. |
| Persistence | **Prisma 5 + SQLite** | Zero-setup file-based database, fully typed schema, perfect for the slice. SQLite + Prisma is trivial to swap for Postgres later by changing the datasource block and the connection string. |
| Chat turn engine | **Rule-based, pluggable** | A typed `ScriptStep[]` per lesson drives the tutor. No LLM dependency required, so the journey is reproducible. The engine is one module (`src/lib/script.ts`) and can be replaced with an LLM-driven engine without touching the route or service layer. |
| Tests | **Vitest 3 (unit + integration) + Playwright (e2e)** | Vitest is fast and matches the TS toolchain; Playwright drives the full journey in a real browser. |
| Lint | **ESLint 9 (flat config) + eslint-config-next 16** | ESLint 9 + Next 16's bundled config gives us a single `eslint .` invocation with no legacy `.eslintrc.json`. |
| Styling | Plain CSS with a small global stylesheet | No design-system overhead for the slice. |

### Trade-offs considered

- **Next.js full-stack vs Node/Express + React SPA**: full-stack won because the slice is small and the developer ergonomics of one framework outweigh the cost of carrying both ends.
- **SQLite vs Postgres**: SQLite keeps the slice one-command; the schema is portable to Postgres with no migrations.
- **Rule-based chat engine vs LLM**: rule-based makes the slice testable and deterministic. The interface (`selectTutorReply(script, conversation) -> { content, isComplete }`) is the seam where an LLM engine can drop in.

## Run it locally

A fresh checkout needs two commands:

```bash
npm ci        # install (uses package-lock.json)
npm run dev   # creates prisma/dev.db, seeds one course + 3 lessons, starts Next on :3000
```

`npm run dev` has a `predev` step (`npm run setup`) that runs `prisma generate`, `prisma db push`, and `tsx prisma/seed.ts` — so the database is always in sync with the schema on every dev start. The npm scripts inline `DATABASE_URL=file:./dev.db` and `CURRENT_LEARNER_ID=demo-learner`, so no `.env` file is required; override either by exporting the env vars in your shell before running `npm run dev`.

### Reset the database

```bash
npm run db:reset
```

## Run the tests

```bash
npm run verify               # typecheck + lint + unit + integration tests
npm run test:e2e             # Playwright starts and owns an isolated dev server
```

The CI workflow (`.github/workflows/ci.yml`) runs the same scripts on every PR.

## Demo the journey (proof recipe)

See [`docs/proof.md`](docs/proof.md) for the exact clicks, an HTTP transcript, and screenshots of the real running app.

## Project layout

```
.
├── prisma/
│   ├── schema.prisma     # data model
│   ├── seed.ts           # idempotent seed (two courses × three lessons)
│   └── dev.db            # SQLite file (gitignored)
├── src/
│   ├── app/              # Next.js App Router (UI + API routes)
│   ├── lib/              # db, script engine, progress, service layer
│   └── ...
├── scripts/
│   ├── capture-proof.mts                  # original 3/3 journey screenshots
│   ├── capture-polish-screenshots.mts     # compact composer + mobile screenshots
│   └── capture-dashboard-screenshots.mts  # multi-course dashboard screenshots
├── tests/
│   ├── unit/             # pure unit tests (no DB)
│   ├── integration/      # DB-backed service tests
│   └── e2e/              # Playwright headless journey
├── docs/
│   ├── proof.md                      # proof doc with screenshots + transcript
│   ├── proof-http-transcript.txt     # captured HTTP responses
│   └── screenshots/                  # PNG screenshots of the journey
└── .github/workflows/    # CI: lint + typecheck + unit + e2e
```

More detail in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## What's explicitly **not** in this slice

Auth, user accounts, admin/course-author UI, real LLM integration, streaming, multimodal input, notifications, email, analytics, billing, mobile apps, i18n. These are tracked as future work.

## Dashboard, at a glance

The home page (`src/app/page.tsx`) renders two regions:

- **Continue learning** — a single card that surfaces the most-recently-active unfinished course. Hidden when no course has progress.
- **All courses** — the full catalog, with per-course state (`Not started`, `x / y complete`, `Complete`) and a primary action (`Start course →`, `Continue →`, or `Review →`).

Selection logic lives in [`src/lib/progress.ts`](src/lib/progress.ts):

- `pickRecentActiveCourse(courses, learnerId)` — returns the unfinished course whose most-recent `Progress.updatedAt` is the latest. A complete course is never a candidate, even if its activity is more recent.
- `summariseCourseProgress(course, learnerId)` — derives `state`, `completed`, `total`, and `lastActivityAt` per course.

Both helpers are unit-tested in [`tests/unit/progress.test.ts`](tests/unit/progress.test.ts) and integration-tested in [`tests/integration/journey.test.ts`](tests/integration/journey.test.ts).
