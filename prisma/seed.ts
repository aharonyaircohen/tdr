// Seed: two courses with three lessons each. Idempotent — uses upsert on unique slugs.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type TutorLine = { kind: "tutor"; content: string; expect?: undefined };
type LearnerPrompt = { kind: "learner"; prompt: string; expect: string[] };
type Step = TutorLine | LearnerPrompt;

const lessonScripts: Record<string, Step[]> = {
  "what-is-llm": [
    {
      kind: "tutor",
      content:
        "Welcome! In this lesson we will explore what a large language model actually is. " +
        "Think of it as a very advanced text predictor — given some text, it predicts what comes next. " +
        "Reply with 'next' when you are ready to continue.",
    },
    {
      kind: "learner",
      prompt: "Learner indicates they are ready to continue.",
      expect: ["next", "continue", "ready", "ok", "okay", "yes"],
    },
    {
      kind: "tutor",
      content:
        "Great. An LLM is trained on huge amounts of text from the internet, books, and code. " +
        "It learns patterns — grammar, facts, reasoning styles — by predicting the next word in millions of sentences. " +
        "Tell me one thing you already knew about LLMs, in any words you like.",
    },
    {
      kind: "learner",
      prompt: "Learner shares something they already knew.",
      expect: [
        "i know",
        "i knew",
        "learned",
        "read",
        "heard",
        "llm",
        "model",
        "ai",
        "predict",
        "text",
      ],
    },
    {
      kind: "tutor",
      content:
        "Nice — that is a solid intuition. LLMs do not 'think' the way humans do; they are extremely good pattern matchers. " +
        "Type 'done' to mark this lesson complete and move to the next one.",
    },
    {
      kind: "learner",
      prompt: "Learner marks the lesson complete.",
      expect: ["done", "finish", "complete", "next"],
    },
  ],
  "tokens-and-context": [
    {
      kind: "tutor",
      content:
        "Welcome back. In this lesson we will talk about tokens — the units an LLM actually reads and writes. " +
        "Words are usually split into smaller pieces called tokens. Say 'next' to continue.",
    },
    {
      kind: "learner",
      prompt: "Learner is ready.",
      expect: ["next", "continue", "ready", "ok", "okay", "yes"],
    },
    {
      kind: "tutor",
      content:
        "Tokens are how an LLM counts. A short word is usually one token; a long word may be two or three. " +
        "Tell me roughly how many tokens you think the sentence 'Hello, world!' uses.",
    },
    {
      kind: "learner",
      prompt: "Learner gives a number estimate.",
      expect: ["two", "three", "2", "3", "few", "tokens", "small"],
    },
    {
      kind: "tutor",
      content:
        "Exactly — a short sentence like that is just a handful of tokens. Now think about context: " +
        "every LLM has a context window, the maximum number of tokens it can consider at once. " +
        "Type 'done' to complete this lesson.",
    },
    {
      kind: "learner",
      prompt: "Learner marks the lesson complete.",
      expect: ["done", "finish", "complete", "next"],
    },
  ],
  "prompts-are-programs": [
    {
      kind: "tutor",
      content:
        "Last lesson. The big idea: prompts are programs. " +
        "The prompt you give an LLM is essentially the program it runs. " +
        "Better prompts produce better outputs. Say 'next' to continue.",
    },
    {
      kind: "learner",
      prompt: "Learner is ready.",
      expect: ["next", "continue", "ready", "ok", "okay", "yes"],
    },
    {
      kind: "tutor",
      content:
        "Good. A useful prompt has three parts: clear intent, useful context, and a specific output shape. " +
        "Name one of those three parts back to me.",
    },
    {
      kind: "learner",
      prompt: "Learner names a part.",
      expect: ["intent", "context", "output", "shape", "format", "specific"],
    },
    {
      kind: "tutor",
      content:
        "You have completed the vertical slice. Type 'done' to mark this lesson complete.",
    },
    {
      kind: "learner",
      prompt: "Learner marks the lesson complete.",
      expect: ["done", "finish", "complete", "next"],
    },
  ],
  "role-and-audience": [
    {
      kind: "tutor",
      content:
        "Welcome. In this lesson we will talk about giving the model a role and an audience. " +
        "Telling the LLM who it should act as — and who it should write for — is one of the highest-leverage moves in prompting. " +
        "Say 'next' to continue.",
    },
    {
      kind: "learner",
      prompt: "Learner is ready.",
      expect: ["next", "continue", "ready", "ok", "okay", "yes"],
    },
    {
      kind: "tutor",
      content:
        "Compare two prompts: 'Explain HTTP status codes' versus 'You are a backend mentor explaining HTTP status codes to a junior engineer.' " +
        "The second one almost always produces a more focused, better-pitched answer. " +
        "In one sentence, tell me why you think that is.",
    },
    {
      kind: "learner",
      prompt: "Learner explains why the role helps.",
      expect: [
        "audience",
        "reader",
        "context",
        "focus",
        "tone",
        "level",
        "junior",
        "mentor",
        "role",
        "specific",
        "voice",
      ],
    },
    {
      kind: "tutor",
      content:
        "Exactly — the role and audience narrow the model's choices about tone, depth, and vocabulary. " +
        "Type 'done' to complete this lesson.",
    },
    {
      kind: "learner",
      prompt: "Learner marks the lesson complete.",
      expect: ["done", "finish", "complete", "next"],
    },
  ],
  "few-shot-examples": [
    {
      kind: "tutor",
      content:
        "Next lesson: few-shot examples. Showing the model two or three input/output pairs in the prompt " +
        "is often more effective than describing the pattern in words. Say 'next' to continue.",
    },
    {
      kind: "learner",
      prompt: "Learner is ready.",
      expect: ["next", "continue", "ready", "ok", "okay", "yes"],
    },
    {
      kind: "tutor",
      content:
        "A few-shot block turns the prompt from a description into a worked example. " +
        "Give me one scenario — in plain language — where a few-shot prompt would beat a zero-shot one.",
    },
    {
      kind: "learner",
      prompt: "Learner gives a scenario.",
      expect: [
        "format",
        "style",
        "translation",
        "classification",
        "extract",
        "summary",
        "summarize",
        "json",
        "tag",
        "category",
        "tone",
      ],
    },
    {
      kind: "tutor",
      content:
        "Perfect. Examples anchor the output shape far more reliably than instructions alone. " +
        "Type 'done' to finish this lesson.",
    },
    {
      kind: "learner",
      prompt: "Learner marks the lesson complete.",
      expect: ["done", "finish", "complete", "next"],
    },
  ],
  "constraints-and-checks": [
    {
      kind: "tutor",
      content:
        "Final lesson. Constraints and checks. The best prompts close every door they do not want the model to walk through: " +
        "no markdown, no apologies, must return JSON, must cite sources. Say 'next' to continue.",
    },
    {
      kind: "learner",
      prompt: "Learner is ready.",
      expect: ["next", "continue", "ready", "ok", "okay", "yes"],
    },
    {
      kind: "tutor",
      content:
        "Right — explicit constraints and a verification step (asking the model to re-read its answer before finalising) " +
        "are the cheapest reliability upgrade you can make. " +
        "Name one constraint you would add to a prompt that summarises a long article into bullet points.",
    },
    {
      kind: "learner",
      prompt: "Learner names a constraint.",
      expect: [
        "bullet",
        "bullets",
        "limit",
        "max",
        "five",
        "short",
        "no",
        "json",
        "format",
        "tone",
        "length",
        "words",
        "citations",
        "cite",
      ],
    },
    {
      kind: "tutor",
      content:
        "Great — you have finished the second course. Type 'done' to mark this lesson complete.",
    },
    {
      kind: "learner",
      prompt: "Learner marks the lesson complete.",
      expect: ["done", "finish", "complete", "next"],
    },
  ],
};

async function upsertCourse(slug: string, title: string, description: string) {
  return prisma.course.upsert({
    where: { slug },
    update: {},
    create: { slug, title, description },
  });
}

async function upsertLesson(
  courseId: string,
  spec: { slug: string; title: string; order: number },
  script: Step[],
) {
  await prisma.lesson.upsert({
    where: { courseId_slug: { courseId, slug: spec.slug } },
    update: { title: spec.title, order: spec.order, script: JSON.stringify(script) },
    create: {
      courseId,
      slug: spec.slug,
      title: spec.title,
      order: spec.order,
      script: JSON.stringify(script),
    },
  });
}

async function main() {
  // ----- Course A: existing vertical slice -----
  const courseA = await upsertCourse(
    "intro-to-llms",
    "Intro to Large Language Models",
    "A short, chat-based introduction to how large language models work, " +
      "delivered as a guided conversation with a tutor.",
  );

  const courseALessons: { slug: string; title: string; order: number }[] = [
    { slug: "what-is-llm", title: "What is an LLM?", order: 1 },
    { slug: "tokens-and-context", title: "Tokens and context windows", order: 2 },
    { slug: "prompts-are-programs", title: "Prompts are programs", order: 3 },
  ];
  for (const spec of courseALessons) {
    const script = lessonScripts[spec.slug];
    if (!script) throw new Error(`Missing script for lesson ${spec.slug}`);
    await upsertLesson(courseA.id, spec, script);
  }

  // ----- Course B: new in issue #5 -----
  const courseB = await upsertCourse(
    "prompting-patterns",
    "Prompting patterns for engineers",
    "Three short, chat-based lessons on the highest-leverage moves you can make " +
      "in the prompts you give to an LLM.",
  );

  const courseBLessons: { slug: string; title: string; order: number }[] = [
    { slug: "role-and-audience", title: "Role and audience", order: 1 },
    { slug: "few-shot-examples", title: "Few-shot examples", order: 2 },
    { slug: "constraints-and-checks", title: "Constraints and checks", order: 3 },
  ];
  for (const spec of courseBLessons) {
    const script = lessonScripts[spec.slug];
    if (!script) throw new Error(`Missing script for lesson ${spec.slug}`);
    await upsertLesson(courseB.id, spec, script);
  }

  // Clean any orphan messages/progress for these lessons so seed is idempotent on content too.
  const allLessonIds = (
    await prisma.lesson.findMany({
      where: { courseId: { in: [courseA.id, courseB.id] } },
    })
  ).map((l) => l.id);
  await prisma.message.deleteMany({ where: { lessonId: { in: allLessonIds } } });
  await prisma.progress.deleteMany({ where: { lessonId: { in: allLessonIds } } });

  console.log(
    `Seeded 2 courses with ${courseALessons.length + courseBLessons.length} lessons total.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });