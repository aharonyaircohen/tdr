import { describe, it, expect } from "vitest";
import {
  parseScript,
  selectTutorReply,
  matchesExpect,
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
    // We expect a tutor line because the engine replays position 0 then
    // surfaces the next tutor step at index 2 (since the learner mismatch
    // doesn't advance). It should not throw.
    expect(typeof reply.content).toBe("string");
    expect(reply.isComplete).toBe(false);
  });
});