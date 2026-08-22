import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCourseWithLessons, pickResumeLesson } from "@/lib/service";
import { getCurrentLearnerId } from "@/lib/learner";

export const dynamic = "force-dynamic";

type Params = { slug: string };

export default async function CoursePage({ params }: { params: Params }) {
  const course = await getCourseWithLessons(params.slug);
  if (!course) notFound();

  const learnerId = getCurrentLearnerId();
  const resume = pickResumeLesson(course.lessons, learnerId);

  // The course overview is reachable from the lesson header's back-link. We
  // do not auto-redirect from here so the learner can see their overall
  // progress at a glance. The home page links directly into the resume lesson.

  const completedCount = course.lessons.filter((l) =>
    l.progress.some((p) => p.learnerId === learnerId && p.completed),
  ).length;

  return (
    <main className="container">
      <header className="page-header">
        <h1>{course.title}</h1>
        <Link href="/" data-testid="back-home">← All courses</Link>
      </header>
      <p className="muted">{course.description}</p>

      <section style={{ marginTop: 24 }}>
        <div
          style={{ display: "flex", justifyContent: "space-between" }}
          data-testid="course-progress"
        >
          <strong>Lessons</strong>
          <span className="muted" data-testid="progress-count">
            {completedCount} / {course.lessons.length} complete
          </span>
        </div>
        <div className="progress-bar" aria-hidden>
          <div
            style={{
              width: `${
                course.lessons.length === 0
                  ? 0
                  : (completedCount / course.lessons.length) * 100
              }%`,
            }}
          />
        </div>

        <ul className="lesson-list" style={{ marginTop: 16 }} data-testid="lesson-list">
          {course.lessons.map((lesson) => {
            const p = lesson.progress.find((row) => row.learnerId === learnerId);
            const isDone = p?.completed === true;
            const isCurrent = resume?.id === lesson.id;
            const cls = [
              "lesson-item",
              isDone ? "done" : "",
              isCurrent ? "current" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li key={lesson.id} className={cls} data-testid={`lesson-${lesson.slug}`}>
                <span>
                  {lesson.order}. {lesson.title}
                </span>
                <span className="badge">
                  {isDone ? "Done" : isCurrent ? "Current" : "Up next"}
                </span>
                <Link
                  href={`/courses/${course.slug}/lessons/${lesson.slug}`}
                  style={{ marginLeft: 12 }}
                  data-testid={`lesson-link-${lesson.slug}`}
                >
                  {isDone ? "Review" : isCurrent ? "Continue" : "Start"} →
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}