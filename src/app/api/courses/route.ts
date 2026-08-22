import { NextResponse } from "next/server";
import { listCourses } from "@/lib/service";

/**
 * GET /api/courses
 *
 * Returns the list of available courses with a flat per-course summary
 * suitable for CLI / HTTP-driven exploration (see docs/proof.md).
 */
export async function GET() {
  const courses = await listCourses();
  return NextResponse.json(courses);
}
