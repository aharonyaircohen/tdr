import { NextResponse } from "next/server";
import { sendTurn, NotFoundError, BadInputError } from "@/lib/service";
import { getCurrentLearnerId } from "@/lib/learner";

/**
 * Send a learner turn for a lesson. Persists the learner message, computes
 * the next tutor turn using the rule-based script engine, persists it, and
 * updates progress.
 *
 * Request body: { content: string }
 * Response:     { learnerMessage, tutorMessage, isComplete }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { content?: unknown }).content !== "string"
  ) {
    return NextResponse.json(
      { error: "Field 'content' is required and must be a string" },
      { status: 400 },
    );
  }
  const content = ((body as { content: string }).content || "").trim();
  if (content.length === 0) {
    return NextResponse.json({ error: "Empty messages are not allowed" }, { status: 400 });
  }
  if (content.length > 4000) {
    return NextResponse.json(
      { error: "Message too long (max 4000 chars)" },
      { status: 400 },
    );
  }

  try {
    const { lessonId } = await params;
    const result = await sendTurn({
      lessonId,
      learnerId: getCurrentLearnerId(),
      content,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e instanceof BadInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}