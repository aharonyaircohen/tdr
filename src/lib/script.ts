// Pure rule-based chat turn engine. Drives the lesson from a scripted list of
// tutor lines and expected learner prompts. The script is stored on the Lesson
// row as JSON. The engine is deliberately pluggable — see `selectTutorReply`.

export type ScriptStep =
  | { kind: "tutor"; content: string }
  | { kind: "learner"; prompt: string; expect: string[] };

export type ConversationTurn = { role: "tutor" | "learner"; content: string };

export type TutorReply = {
  content: string;
  isComplete: boolean;
  nextStepIndex: number;
};

export type ScriptState = {
  stepIndex: number;
  awaitingLearner: boolean;
  complete: boolean;
};

export function parseScript(scriptJson: string): ScriptStep[] {
  const parsed = JSON.parse(scriptJson);
  if (!Array.isArray(parsed)) {
    throw new Error("Lesson script must be a JSON array");
  }
  return parsed as ScriptStep[];
}

/**
 * Determine the next tutor reply for a lesson, given the full conversation so far.
 *
 * Rules:
 * - The script is a list of alternating tutor / learner expected inputs.
 * - Each learner message in the conversation is checked against the current
 *   expected learner step. If any of its `expect` keywords appears (case-insensitive,
 *   word-boundary), the script advances to the next step.
 * - If the next step is a tutor line, we emit it.
 * - If the conversation already contains the final tutor line and the learner has
 *   satisfied its expected reply, we mark the lesson complete.
 */
export function selectTutorReply(
  script: ScriptStep[],
  conversation: ConversationTurn[],
): TutorReply {
  // Walk the script using the recorded conversation to find our position.
  let stepIndex = 0;
  let awaitingLearner = false;
  let complete = false;

  // The very first turn must always be a tutor line. If the conversation is
  // empty, emit it.
  if (conversation.length === 0) {
    const first = script[0];
    if (!first || first.kind !== "tutor") {
      throw new Error("Lesson script must begin with a tutor line");
    }
    return { content: first.content, isComplete: false, nextStepIndex: 1 };
  }

  // Replay conversation against script to find current position.
  let convoIdx = 0;
  while (stepIndex < script.length && convoIdx < conversation.length) {
    const step = script[stepIndex];
    const turn = conversation[convoIdx];
    if (step.kind === "tutor") {
      if (turn.role !== "tutor" || turn.content !== step.content) {
        // Mismatch — fall through to error handling below.
        break;
      }
      stepIndex += 1;
      convoIdx += 1;
    } else {
      // learner expected input
      if (turn.role !== "learner") {
        break;
      }
      if (!matchesExpect(turn.content, step.expect)) {
        break;
      }
      stepIndex += 1;
      convoIdx += 1;
    }
  }

  // After replay, stepIndex points at the next expected step.
  // If we've consumed the whole script, the lesson is complete.
  if (stepIndex >= script.length) {
    complete = true;
    return {
      content: "Lesson complete. Move on to the next lesson when you're ready.",
      isComplete: true,
      nextStepIndex: stepIndex,
    };
  }

  const next = script[stepIndex];
  if (next.kind === "tutor") {
    if (convoIdx < conversation.length) {
      // The conversation has more turns than the script expects at this point.
      // Treat as a divergence — ask for clarification rather than guess.
      return {
        content:
          "I am a bit lost. Could you reply to my last message so I can keep going?",
        isComplete: false,
        nextStepIndex: stepIndex,
      };
    }
    // If this is the final tutor line in the lesson, the lesson is complete.
    const isLast = stepIndex + 1 >= script.length;
    return {
      content: next.content,
      isComplete: isLast,
      nextStepIndex: stepIndex + 1,
    };
  }

  // Next step is a learner input — we should NOT be called in this state.
  // The endpoint should never post a learner turn that doesn't match; if it
  // does, we return a gentle nudge.
  awaitingLearner = true;
  return {
    content: "I'm waiting for your reply.",
    isComplete: false,
    nextStepIndex: stepIndex,
  };
}

export function matchesExpect(content: string, expect: string[]): boolean {
  const lc = content.toLowerCase();
  return expect.some((kw) => {
    const needle = kw.toLowerCase();
    const re = new RegExp(`\\b${escapeRegex(needle)}\\b`, "i");
    return re.test(lc);
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function initialScriptState(): ScriptState {
  return { stepIndex: 0, awaitingLearner: false, complete: false };
}