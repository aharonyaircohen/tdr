import { NextResponse } from "next/server";
import { markLessonComplete, NotFoundError } from "@/lib/service";
import { getCurrentLearnerId } from "@/lib/learner";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  try {
    const { lessonId } = await params;
    await markLessonComplete(lessonId, getCurrentLearnerId());
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}