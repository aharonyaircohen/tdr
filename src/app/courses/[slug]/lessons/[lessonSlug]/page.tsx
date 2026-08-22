import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourseWithLessons, getLessonWithMessages, pickResumeLesson } from "@/lib/service";
import { getCurrentLearnerId } from "@/lib/learner";
import { ChatLesson } from "./chat-lesson";

export const dynamic = "force-dynamic";

type Params = { slug: string; lessonSlug: string };

export default async function LessonPage({ params }: { params: Promise<Params> }) {
  const { slug, lessonSlug } = await params;
  const course = await getCourseWithLessons(slug);
  if (!course) notFound();
  const lesson = course.lessons.find((l) => l.slug === lessonSlug);
  if (!lesson) notFound();

  const detail = await getLessonWithMessages(lesson.id);
  if (!detail) notFound();

  const learnerId = getCurrentLearnerId();
  const isComplete =
    detail.progress.find((p) => p.learnerId === learnerId)?.completed === true;

  const resume = pickResumeLesson(course.lessons, learnerId);

  const completedCount = course.lessons.filter((l) =>
    l.progress.some((p) => p.learnerId === learnerId && p.completed),
  ).length;

  const sortedLessons = [...course.lessons].sort((a, b) => a.order - b.order);
  const idx = sortedLessons.findIndex((l) => l.id === lesson.id);
  const prevLesson = idx > 0 ? sortedLessons[idx - 1] : null;
  const nextLesson = idx < sortedLessons.length - 1 ? sortedLessons[idx + 1] : null;

  // Serialise messages for the client component.
  const messages = detail.messages.map((m) => ({
    id: m.id,
    role: m.role === "tutor" ? ("tutor" as const) : ("learner" as const),
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <main className="container">
      <header className="page-header">
        <div>
          <div className="muted">
            <Link href={`/courses/${course.slug}`} data-testid="back-to-course">
              ← {course.title}
            </Link>
          </div>
          <h1>{lesson.title}</h1>
        </div>
        <span className="muted" data-testid="lesson-progress">
          {completedCount} / {course.lessons.length} lessons complete
        </span>
      </header>

      <ChatLesson
        lessonId={lesson.id}
        courseSlug={course.slug}
        lessonSlug={lesson.slug}
        initialMessages={messages}
        isComplete={isComplete}
        isCurrent={resume?.id === lesson.id}
        hasPrev={Boolean(prevLesson)}
        hasNext={Boolean(nextLesson)}
        prevSlug={prevLesson?.slug ?? null}
        nextSlug={nextLesson?.slug ?? null}
      />
    </main>
  );
}