# Architecture

This document describes how the vertical slice is put together. It is intentionally small: one stack, four models, one chat turn flow, one home dashboard, and one resume flow.

## Stack

- **Next.js 16 App Router** (TypeScript) for both UI (React server components + one client component for the chat) and the HTTP API (`/api/lessons/[id]/...` route handlers).
- **Prisma + SQLite** for persistence. The schema lives in `prisma/schema.prisma`.
- **Vitest + Playwright** for tests.

## Data model

Four tables. See `prisma/schema.prisma`.

```
Course (1) ──< Lesson (n)
Lesson (n) ──< Message (n)        // chat turns
Lesson (n) ──< Progress (n)       // learner × lesson
```

- **Course**: `id`, `slug`, `title`, `description`, `createdAt`.
- **Lesson**: `id`, `courseId`, `slug`, `title`, `order`, `script` (JSON-encoded `ScriptStep[]`), `createdAt`. Unique on `(courseId, slug)`.
- **Message**: `id`, `lessonId`, `role` (`"tutor"` | `"learner"`), `content`, `createdAt`.
- **Progress**: `id`, `learnerId`, `lessonId`, `completed`, `updatedAt`. Unique on `(learnerId, lessonId)`.

### Why these tables

- `Course` and `Lesson` are the canonical LMS shape; ordering is on `Lesson.order` so courses don't need a join table.
- `Message` is append-only chat history, ordered by `createdAt`. Index on `(lessonId, createdAt)` for the common "load the transcript for a lesson" query.
- `Progress` is intentionally one row per `(learner, lesson)` rather than a single per-course row. That makes "next unfinished lesson" (`pickResumeLesson`) trivial and keeps future multi-course progress cheap.

## Chat turn flow

```
learner types in <textarea>
       │
       ▼
client POST /api/lessons/:lessonId/messages     { content: "..." }
       │
       ▼
route handler (`messages/route.ts`)
       │  validates body, resolves learnerId from env
       ▼
service.sendTurn({ lessonId, learnerId, content })
       │
       │  prisma.$transaction:
       │    1. INSERT Message (role: "learner")
       │    2. SELECT all messages for lessonId ORDER BY createdAt
       │    3. parseScript(lesson.script)
       │    4. selectTutorReply(script, conversation) -> { content, isComplete, nextStepIndex }
       │    5. INSERT Message (role: "tutor") with reply.content  (unless terminal)
       │    6. UPSERT Progress (learnerId, lessonId) set completed = isComplete
       ▼
returns { learnerMessage, tutorMessage, isComplete }
       │
       ▼
client prepends learner bubble, appends tutor bubble, refreshes server view
```

### Why a transaction

The learner turn, the tutor turn, and the progress update either all land or all roll back. This prevents the "tutor answered but no progress row was created" inconsistency that would otherwise be observable after a server crash mid-transaction.

### `selectTutorReply`

`src/lib/script.ts`. Pure function. Inputs:

- `script: ScriptStep[]` — either `{ kind: "tutor", content }` or `{ kind: "learner", prompt, expect: string[] }`.
- `conversation: { role, content }[]` — every message persisted for the lesson, in order.

Output: `{ content: string, isComplete: boolean, nextStepIndex: number }`.

The algorithm walks the script and the conversation in lockstep. If the conversation agrees with the script so far, it advances to the next step. If the next step is a tutor line and there are no more conversation turns to consume, the tutor line is emitted. If the script is exhausted, the lesson is marked complete.

### Recovery from a wrong learner answer

A wrong learner turn (one whose content does not match any `expect` keyword for the current learner step) is **persisted as a normal `Message` row** and remains visible in the transcript — it is not deleted, edited, or hidden. During replay, the engine skips only that wrong turn and the exact retry feedback generated for the same learner step. Other tutor or ordering mismatches still fail safely instead of being hidden as noise.

After replay, if the engine is still positioned at the learner step because its latest answer was wrong, the reply is **concise retry feedback** that references the scripted learner prompt: `That doesn't match what I'm looking for. Try again — I'm asking: <prompt>.` (see `retryFeedback`). The `prompt` field is therefore learner-facing course content, while `expect` remains the internal matching rubric. Otherwise the engine returns the natural waiting nudge (`I'm waiting for your reply.`).

This is what lets a learner recover from a wrong answer: the wrong turn is visible, the retry feedback tells them what the tutor is asking for, and the next matching reply advances the lesson as if the wrong turn had never happened. The lesson can also be refreshed and resumed mid-recovery — the persisted transcript (including wrong turns and retry feedback) is loaded as-is and the engine's skip-noise replay handles it.

The engine is deliberately small. It has no external dependencies, and is the only place where lesson-content rules live. Swapping in an LLM means replacing `selectTutorReply` with an LLM call that returns the same shape.

## Resume flow

```
browser closes mid-lesson
       │
       ▼
browser reopens → GET /
       │
       ▼
learner clicks the course → GET /courses/:slug
       │
       │  service.getCourseWithLessons() returns course + lessons + this learner's progress
       │  pickResumeLesson(lessons, learnerId) → first lesson with no Progress or !completed
       │
       ▼
if no progress at all → redirect to /courses/:slug/lessons/:firstLessonSlug
otherwise render lesson list with badges (Done / Current / Up next)
       │
       ▼
learner clicks "Continue" → GET /courses/:slug/lessons/:resumeSlug
       │
       ▼
ChatLesson client component
  - hydrates with messages from getLessonWithMessages()
  - shows the persisted transcript (prior turns restored)
  - the learner picks up where they left off
```

### Resume correctness invariants

1. `pickResumeLesson` returns the lowest-`order` lesson whose progress row is missing or has `completed = false`. (If everything is complete, it returns the last lesson.)
2. `canEnterLesson(lessons, learnerId, targetId)` enforces ordering: the learner can only enter a lesson whose predecessors are all complete. This is the **single policy owner** for the sequential-path rule. The course overview uses it to mark future lessons as `Locked` instead of rendering a link, the lesson page uses it to `redirect()` a direct URL to a locked future lesson back to the resume lesson, and the chat-lesson client uses the `complete` flag to suppress the in-lesson `Next lesson` action until the current lesson is done.
3. Progress is upserted, not inserted, on every learner action — this makes resume idempotent across repeated sends.

### Sequential-path enforcement

The UI and routes apply `canEnterLesson` at three points:

- **Course overview** (`src/app/courses/[slug]/page.tsx`) — for each lesson, compute `isLocked = !isDone && !canEnterLesson(...)`. Locked lessons render the `Locked` badge and a short explanation instead of a `Review`/`Continue`/`Start` link. Previously-completed lessons remain `Done` + `Review`; the resume lesson is `Current` + `Continue`.
- **Lesson page** (`src/app/courses/[slug]/lessons/[lessonSlug]/page.tsx`) — before rendering the chat, if `canEnterLesson(...)` is false for the requested lesson, the page calls `redirect()` to `/courses/:slug/lessons/:resumeLessonSlug`. Past completed lessons and the resume lesson itself are always enterable.
- **Chat lesson** (`src/app/courses/[slug]/lessons/[lessonSlug]/chat-lesson.tsx`) — the in-lesson `Next lesson →` link is only rendered when `complete && hasNext`. It becomes available immediately after the lesson flips to complete via either a scripted terminal turn or the explicit `Mark complete` button.

## Dashboard flow (multi-course)

The home page (`src/app/page.tsx`) is a learner dashboard with two regions:

```
GET /
   │
   ▼
service.listCourses() + summariseCourseProgress() per course
   │
   ▼
pickRecentActiveCourse(courses, learnerId)
   │
   ▼
Render:
  - Continue learning card  (only when an unfinished course has activity)
  - All courses catalog     (every course, with state + primary action)
```

### Selection invariants

- `pickRecentActiveCourse` ignores courses whose every lesson is completed — a finished course cannot displace an in-progress one.
- Among unfinished courses with at least one `Progress` row, the one whose **most recent** `Progress.updatedAt` is the latest wins.
- `lastActivityAt` is the largest `Progress.updatedAt` across the course's lessons (any completion status), so the dashboard can also surface "last touched" metadata for complete courses.

### State derivation (`summariseCourseProgress`)

| Condition | State |
| --- | --- |
| No `Progress` rows for this learner | `not-started` |
| Every lesson has `completed = true` | `complete` |
| Otherwise | `in-progress` |

The same helper returns `completed`, `total`, and `lastActivityAt`. The home page maps state to a primary action:

| State | Primary action | Destination |
| --- | --- | --- |
| `not-started` | `Start course →` | `/courses/:slug/lessons/:startLessonSlug` |
| `in-progress` | `Continue →` | `/courses/:slug/lessons/:resumeLessonSlug` |
| `complete` | `Review →` | `/courses/:slug/lessons/:startLessonSlug` |

### Isolation by course

`Progress` is keyed on `(learnerId, lessonId)`. Because every helper filters by `learnerId` before comparing courses, courses cannot leak progress into one another. This is the same invariant the resume flow already depended on; the dashboard builds on top of it.

## File layout

```
prisma/
  schema.prisma         # the four tables
  seed.ts               # two courses × three lessons, idempotent (upsert by slug)

src/lib/
  db.ts                 # singleton Prisma client
  learner.ts            # resolves the (currently hard-coded) learner id
  script.ts             # pure rule-based chat turn engine
  progress.ts           # pickResumeLesson, pickRecentActiveCourse,
                        # summariseCourseProgress, canEnterLesson, isLessonComplete
  service.ts            # the only writer to the DB from request handlers

src/app/
  layout.tsx
  page.tsx                                    # learner dashboard (Continue + catalog)
  courses/[slug]/page.tsx                     # course view (lesson list + progress)
  courses/[slug]/lessons/[lessonSlug]/
    page.tsx                                   # server: hydrate transcript
    chat-lesson.tsx                            # client: chat form + transcript
  api/courses/route.ts                        # GET: list courses (JSON, extended)
  api/courses/[slug]/route.ts                 # GET: course + lessons (JSON)
  api/lessons/[lessonId]/seed/route.ts        # POST: emit opening tutor line
  api/lessons/[lessonId]/messages/route.ts    # POST: sendTurn
  api/lessons/[lessonId]/complete/route.ts    # POST: explicit mark-complete

tests/
  unit/                # pure unit tests for script.ts and progress.ts
  integration/         # DB-backed service tests (fresh sqlite per test)
  e2e/                 # Playwright full-journey + multi-course dashboard tests
```

## Out of scope

- Auth — `CURRENT_LEARNER_ID` env var stands in for a real session.
- Multi-tenant, admin UI, course authoring, payments, analytics, notifications.
- Streaming or real LLM. `selectTutorReply` is the seam.
