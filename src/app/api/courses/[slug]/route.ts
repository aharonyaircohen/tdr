import { NextResponse } from "next/server";
import { getCourseWithLessons } from "@/lib/service";

/**
 * GET /api/courses/:slug
 *
 * Returns a single course with its lessons array. Each lesson row exposes
 * `id`, `slug`, `title`, and `order`, matching the shape used by
 * docs/proof.md.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const course = await getCourseWithLessons(slug);
  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }
  return NextResponse.json({
    id: course.id,
    slug: course.slug,
    title: course.title,
    description: course.description,
    lessons: course.lessons
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((lesson) => ({
        id: lesson.id,
        slug: lesson.slug,
        title: lesson.title,
        order: lesson.order,
      })),
  });
}
