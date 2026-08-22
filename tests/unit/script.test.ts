import { describe, it, expect } from "vitest";
import {
  parseScript,
  selectTutorReply,
  matchesExpect,
  retryFeedback,
  ScriptStep,
} from "@/lib/script";

const sampleScript: ScriptStep[] = [
  { kind: "tutor", content: "Welcome!" },
  { kind: "learner", prompt: "ready", expect: ["next", "ready"] },
  { kind: "tutor", content: "Great, let us continue." },
  { kind: "learner", prompt: "yes", expect: ["yes", "ok"] },
  { kind: "tutor", content: "Done — you finished." },
];

describe("parseScript", () => {
  it("parses a JSON-encoded array", () => {
    const json = JSON.stringify(sampleScript);
    expect(parseScript(json)).toEqual(sampleScript);
  });

  it("throws on non-array input", () => {
    expect(() => parseScript("{}")).toThrow();
  });
});

describe("matchesExpect", () => {
  it("matches when a keyword appears as a word", () => {
    expect(matchesExpect("I'm ready", ["ready"])).toBe(true);
    expect(matchesExpect("ready to go", ["next", "ready"])).toBe(true);
  });

  it("does not match substrings inside other words", () => {
    expect(matchesExpect("unready", ["ready"])).toBe(false);
  });

  it("is case insensitive", () => {
    expect(matchesExpect("READY", ["ready"])).toBe(true);
  });

  it("escapes regex metachars in keywords", () => {
    expect(matchesExpect("a + b", ["a + b"])).toBe(true);
  });
});

describe("selectTutorReply", () => {
  it("emits the opening tutor line on an empty conversation", () => {
    const reply = selectTutorReply(sampleScript, []);
    expect(reply.content).toBe("Welcome!");
    expect(reply.isComplete).toBe(false);
    expect(reply.nextStepIndex).toBe(1);
  });

  it("advances when the learner matches an expected keyword", () => {
    const reply = selectTutorReply(sampleScript, [
      { role: "tutor", content: "Welcome!" },
      { role: "learner", content: "next" },
    ]);
    expect(reply.content).toBe("Great, let us continue.");
    expect(reply.isComplete).toBe(false);
  });

  it("marks the lesson complete when the final tutor line has been delivered and consumed", () => {
    const reply = selectTutorReply(sampleScript, [
      { role: "tutor", content: "Welcome!" },
      { role: "learner", content: "next" },
      { role: "tutor", content: "Great, let us continue." },
      { role: "learner", content: "ok" },
      { role: "tutor", content: "Done — you finished." },
    ]);
    expect(reply.isComplete).toBe(true);
  });

  it("returns a graceful nudge when the learner reply does not match", () => {
    const reply = selectTutorReply(sampleScript, [
      { role: "tutor", content: "Welcome!" },
      { role: "learner", content: "watermelon" },
    ]);
    // The engine does not advance past the wrong answer; it returns concise
    // retry feedback that names the scripted learner prompt.
    expect(typeof reply.content).toBe("string");
    expect(reply.isComplete).toBe(false);
    expect(reply.content).toBe(retryFeedback("ready"));
    expect(reply.content).toContain("ready");
  });
});

describe("selectTutorReply — recovery from a wrong learner answer", () => {
  const recoveryScript: ScriptStep[] = [
    { kind: "tutor", content: "Hello." },
    {
      kind: "learner",
      prompt: "Say when you are ready.",
      expect: ["next", "ready"],
    },
    { kind: "tutor", content: "Continuing." },
    { kind: "learner", prompt: "Say whether you agree.", expect: ["yes"] },
    { kind: "tutor", content: "Done." },
  ];

  it("a wrong learner answer produces retry feedback that references the prompt", () => {
    const reply = selectTutorReply(recoveryScript, [
      { role: "tutor", content: "Hello." },
      { role: "learner", content: "watermelon" },
    ]);
    expect(reply.isComplete).toBe(false);
    expect(reply.content).toBe(
      retryFeedback("Say when you are ready."),
    );
    expect(reply.content).toContain("Say when you are ready.");
  });

  it("a later matching learner answer advances the lesson, ignoring the prior wrong turn", () => {
    const reply = selectTutorReply(recoveryScript, [
      { role: "tutor", content: "Hello." },
      { role: "learner", content: "watermelon" }, // wrong, persisted
      { role: "tutor", content: retryFeedback("Say when you are ready.") },
      { role: "learner", content: "next" }, // correct retry
    ]);
    expect(reply.isComplete).toBe(false);
    expect(reply.content).toBe("Continuing.");
  });

  it("several wrong answers in a row each surface retry feedback", () => {
    const r1 = selectTutorReply(recoveryScript, [
      { role: "tutor", content: "Hello." },
      { role: "learner", content: "watermelon" },
    ]);
    const r2 = selectTutorReply(recoveryScript, [
      { role: "tutor", content: "Hello." },
      { role: "learner", content: "watermelon" },
      { role: "tutor", content: r1.content },
      { role: "learner", content: "potato" },
    ]);
    expect(r1.content).toBe(retryFeedback("Say when you are ready."));
    expect(r2.content).toBe(retryFeedback("Say when you are ready."));
  });

  it("a wrong answer after partial progress still recovers and advances", () => {
    // Conversation: opening tutor, correct first answer, second tutor, wrong
    // second answer. Engine should re-prompt for the same second step.
    const partial = selectTutorReply(recoveryScript, [
      { role: "tutor", content: "Hello." },
      { role: "learner", content: "next" },
      { role: "tutor", content: "Continuing." },
      { role: "learner", content: "watermelon" },
    ]);
    expect(partial.isComplete).toBe(false);
    expect(partial.content).toBe(retryFeedback("Say whether you agree."));

    // Then a correct retry completes the lesson.
    const complete = selectTutorReply(recoveryScript, [
      { role: "tutor", content: "Hello." },
      { role: "learner", content: "next" },
      { role: "tutor", content: "Continuing." },
      { role: "learner", content: "watermelon" },
      { role: "tutor", content: partial.content },
      { role: "learner", content: "yes" },
    ]);
    expect(complete.isComplete).toBe(true);
  });

  it("natural waiting state (no wrong turns in transcript) still uses the existing nudge", () => {
    const reply = selectTutorReply(recoveryScript, [
      { role: "tutor", content: "Hello." },
    ]);
    expect(reply.isComplete).toBe(false);
    expect(reply.content).toBe("I'm waiting for your reply.");
  });

  it("does not silently skip an unexpected tutor turn", () => {
    const reply = selectTutorReply(recoveryScript, [
      { role: "tutor", content: "A corrupted tutor message." },
    ]);
    expect(reply.isComplete).toBe(false);
    expect(reply.content).toContain("I am a bit lost");
    expect(reply.nextStepIndex).toBe(0);
  });

  it("retryFeedback is deterministic and includes the prompt verbatim", () => {
    expect(retryFeedback("Say when you are ready.")).toBe(
      "That doesn't match what I'm looking for. Try again — I'm asking: Say when you are ready.",
    );
  });
});
