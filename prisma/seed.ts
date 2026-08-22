// Seed: one course with three lessons. Idempotent — uses upsert on unique slugs.
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
};

async function main() {
  const course = await prisma.course.upsert({
    where: { slug: "intro-to-llms" },
    update: {},
    create: {
      slug: "intro-to-llms",
      title: "Intro to Large Language Models",
      description:
        "A short, chat-based introduction to how large language models work, " +
        "delivered as a guided conversation with a tutor.",
    },
  });

  const lessonSpecs = [
    { slug: "what-is-llm", title: "What is an LLM?", order: 1 },
    { slug: "tokens-and-context", title: "Tokens and context windows", order: 2 },
    { slug: "prompts-are-programs", title: "Prompts are programs", order: 3 },
  ];

  for (const spec of lessonSpecs) {
    const script = lessonScripts[spec.slug];
    if (!script) throw new Error(`Missing script for lesson ${spec.slug}`);
    await prisma.lesson.upsert({
      where: { courseId_slug: { courseId: course.id, slug: spec.slug } },
      update: { title: spec.title, order: spec.order, script: JSON.stringify(script) },
      create: {
        courseId: course.id,
        slug: spec.slug,
        title: spec.title,
        order: spec.order,
        script: JSON.stringify(script),
      },
    });
  }

  // Clean any orphan messages/progress for these lessons so seed is idempotent on content too.
  const lessonIds = (await prisma.lesson.findMany({ where: { courseId: course.id } })).map(
    (l) => l.id,
  );
  await prisma.message.deleteMany({ where: { lessonId: { in: lessonIds } } });
  await prisma.progress.deleteMany({ where: { lessonId: { in: lessonIds } } });

  console.log(
    `Seeded course "${course.title}" with ${lessonSpecs.length} lessons.`,
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