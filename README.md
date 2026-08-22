# The Digital Reality (TDR)

A chat-based learning management system. This repository is the **vertical slice**: one learner journey, end-to-end, against a running app.

## What you can do

1. Open the app at `http://localhost:3000`.
2. Pick the seeded course ("Intro to Large Language Models").
3. Chat with the tutor through three lessons. Each tutor message advances the lesson; the lesson is marked complete when the script finishes.
4. Close the browser. Reopen the app. You land back on the next unfinished lesson, with all prior chat history restored.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 14 (App Router) + TypeScript** | One framework covers server (API routes, server components) and client (React). Strongly typed end-to-end. Single `next dev` command for development and `next build`/`next start` for production. |
| Persistence | **Prisma + SQLite** | Zero-setup file-based database, fully typed schema, perfect for the slice. SQLite + Prisma is trivial to swap for Postgres later by changing the datasource block and the connection string. |
| Chat turn engine | **Rule-based, pluggable** | A typed `ScriptStep[]` per lesson drives the tutor. No LLM dependency required, so the journey is reproducible. The engine is one module (`src/lib/script.ts`) and can be replaced with an LLM-driven engine without touching the route or service layer. |
| Tests | **Vitest (unit + integration) + Playwright (e2e)** | Vitest is fast and matches the TS toolchain; Playwright drives the full journey in a real browser. |
| Styling | Plain CSS with a small global stylesheet | No design-system overhead for the slice. |

### Trade-offs considered

- **Next.js full-stack vs Node/Express + React SPA**: full-stack won because the slice is small and the developer ergonomics of one framework outweigh the cost of carrying both ends.
- **SQLite vs Postgres**: SQLite keeps the slice one-command; the schema is portable to Postgres with no migrations.
- **Rule-based chat engine vs LLM**: rule-based makes the slice testable and deterministic. The interface (`selectTutorReply(script, conversation) -> { content, isComplete }`) is the seam where an LLM engine can drop in.

## Run it locally

```bash
npm ci              # install (uses package-lock.json)
npm run db:push     # create prisma/dev.db from schema
npm run db:seed     # seed one course with 3 lessons
npm run dev         # http://localhost:3000
```

That's it. The first `npm ci` will also run `prisma generate` via `postinstall`.

### Reset the database

```bash
npm run db:reset
```

## Run the tests

```bash
npm run verify               # typecheck + lint + unit + integration tests
npm run test:e2e             # Playwright (requires a running dev/start server)
```

The CI workflow runs the same scripts on every PR.

## Demo the journey (proof recipe)

See [`docs/proof.md`](docs/proof.md) for the exact clicks and an HTTP transcript.

## Project layout

```
.
├── prisma/
│   ├── schema.prisma     # data model
│   ├── seed.ts           # idempotent seed (one course, three lessons)
│   └── dev.db            # SQLite file (gitignored)
├── src/
│   ├── app/              # Next.js App Router (UI + API routes)
│   ├── lib/              # db, script engine, progress, service layer
│   └── ...
├── tests/
│   ├── unit/             # pure unit tests (no DB)
│   ├── integration/      # DB-backed service tests
│   └── e2e/              # Playwright headless journey
└── .github/workflows/    # CI: lint + unit + e2e
```

More detail in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## What's explicitly **not** in this slice

Auth, user accounts, admin/course-author UI, real LLM integration, streaming, multimodal input, notifications, email, analytics, billing, mobile apps, i18n. These are tracked as future work.