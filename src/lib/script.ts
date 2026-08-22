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
 * - Wrong learner replies and the retry feedback they produce are skipped over
 *   during replay rather than treated as a hard break. Other transcript
 *   mismatches still fail safely instead of being silently accepted. The wrong
 *   learner message stays visible in the transcript; a later matching learner
 *   turn can still advance the script.
 *   On the turn that follows a wrong learner reply, the engine emits concise
 *   retry feedback that references the scripted learner prompt so the learner
 *   knows what to try again.
 */
export function selectTutorReply(
  script: ScriptStep[],
  conversation: ConversationTurn[],
): TutorReply {
  // The very first turn must always be a tutor line. If the conversation is
  // empty, emit it.
  if (conversation.length === 0) {
    const first = script[0];
    if (!first || first.kind !== "tutor") {
      throw new Error("Lesson script must begin with a tutor line");
    }
    return { content: first.content, isComplete: false, nextStepIndex: 1 };
  }

  // Replay conversation against the script. Only a wrong learner reply and the
  // exact retry feedback generated for that step are recoverable. Treating all
  // mismatches as noise would hide corrupted or out-of-order tutor history.
  let stepIndex = 0;
  let convoIdx = 0;
  let wrongAtCurrentLearnerStep = false;
  while (stepIndex < script.length && convoIdx < conversation.length) {
    const step = script[stepIndex];
    const turn = conversation[convoIdx];
    if (step.kind === "tutor") {
      if (turn.role !== "tutor" || turn.content !== step.content) {
        return divergenceReply(stepIndex);
      }
      stepIndex += 1;
      convoIdx += 1;
    } else {
      // learner expected input
      if (turn.role !== "learner") {
        if (turn.role === "tutor" && turn.content === retryFeedback(step.prompt)) {
          convoIdx += 1;
          continue;
        }
        return divergenceReply(stepIndex);
      }
      if (!matchesExpect(turn.content, step.expect)) {
        // Wrong learner answer. Skip past it so a later matching answer can
        // still advance the lesson.
        convoIdx += 1;
        wrongAtCurrentLearnerStep = true;
        continue;
      }
      wrongAtCurrentLearnerStep = false;
      stepIndex += 1;
      convoIdx += 1;
    }
  }

  // After replay, stepIndex points at the next expected step.
  // If we've consumed the whole script, the lesson is complete.
  if (stepIndex >= script.length) {
    return {
      content: "Lesson complete. Move on to the next lesson when you're ready.",
      isComplete: true,
      nextStepIndex: stepIndex,
    };
  }

  const next = script[stepIndex];
  if (next.kind === "tutor") {
    if (convoIdx < conversation.length) {
      // Defensive guard: with the skip-noise replay above this branch is
      // unreachable in normal flow (extra turns are skipped past), but keep a
      // graceful nudge in case future code paths surface this state.
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

  // Next step is a learner input. If we just walked past a wrong reply during
  // replay, surface concise retry feedback that references the scripted
  // prompt so the learner knows what to try again. Otherwise we're in the
  // natural waiting state (the tutor just spoke, awaiting the learner).
  if (wrongAtCurrentLearnerStep) {
    return {
      content: retryFeedback(next.prompt),
      isComplete: false,
      nextStepIndex: stepIndex,
    };
  }
  return {
    content: "I'm waiting for your reply.",
    isComplete: false,
    nextStepIndex: stepIndex,
  };
}

function divergenceReply(stepIndex: number): TutorReply {
  return {
    content: "I am a bit lost. Could you reply to my last message so I can keep going?",
    isComplete: false,
    nextStepIndex: stepIndex,
  };
}

export function retryFeedback(prompt: string): string {
  const trimmed = prompt.replace(/\.\s*$/, "");
  return `That doesn't match what I'm looking for. Try again — I'm asking: ${trimmed}.`;
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
