import Link from "next/link";
import { getLearnerDashboard, type CourseSummary } from "@/lib/service";

export const dynamic = "force-dynamic";

type ContinueCard = {
  courseSlug: string;
  courseTitle: string;
  nextLessonSlug: string | null;
  nextLessonTitle: string | null;
  completedCount: number;
  totalCount: number;
};

function pickContinueCard(
  courses: CourseSummary[],
  continueCourseId: string | null,
): ContinueCard | null {
  const summary = courses.find((course) => course.id === continueCourseId);
  if (!summary) return null;
  return {
    courseSlug: summary.slug,
    courseTitle: summary.title,
    nextLessonSlug: summary.resumeLessonSlug ?? summary.startLessonSlug,
    nextLessonTitle: summary.resumeLessonTitle,
    completedCount: summary.completedCount,
    totalCount: summary.totalCount,
  };
}

function stateLabel(course: CourseSummary): string {
  if (course.state === "not-started") return "Not started";
  if (course.state === "complete") return "Complete";
  return `${course.completedCount} / ${course.totalCount} complete`;
}

function primaryAction(course: CourseSummary) {
  if (course.state === "not-started") {
    return {
      label: "Start course →",
      href: course.startLessonSlug
        ? `/courses/${course.slug}/lessons/${course.startLessonSlug}`
        : `/courses/${course.slug}`,
      testId: `start-course-${course.slug}`,
    };
  }
  if (course.state === "complete") {
    return {
      label: "Review →",
      href: course.startLessonSlug
        ? `/courses/${course.slug}/lessons/${course.startLessonSlug}`
        : `/courses/${course.slug}`,
      testId: `review-course-${course.slug}`,
    };
  }
  const slug = course.resumeLessonSlug ?? course.startLessonSlug;
  return {
    label: "Continue →",
    href: slug
      ? `/courses/${course.slug}/lessons/${slug}`
      : `/courses/${course.slug}`,
    testId: `continue-course-${course.slug}`,
  };
}

export default async function HomePage() {
  const { courses, continueCourseId } = await getLearnerDashboard();
  const continueCard = pickContinueCard(courses, continueCourseId);

  return (
    <main className="container">
      <header className="page-header">
        <h1>The Digital Reality</h1>
        <span className="muted" data-testid="learner-id">Learner: demo</span>
      </header>
      <p className="muted" style={{ marginTop: -8, marginBottom: 24 }}>
        Pick a course to start learning through chat.
      </p>

      {continueCard ? (
        <section
          className="continue-card"
          data-testid="continue-card"
          aria-labelledby="continue-heading"
        >
          <div className="continue-eyebrow">Continue learning</div>
          <h2 id="continue-heading" className="continue-title">
            {continueCard.courseTitle}
          </h2>
          {continueCard.nextLessonTitle ? (
            <p className="muted continue-next">
              Next lesson: <strong>{continueCard.nextLessonTitle}</strong>
            </p>
          ) : null}
          <div className="continue-progress">
            <span data-testid="continue-progress-count">
              {continueCard.completedCount} / {continueCard.totalCount} complete
            </span>
            <div className="progress-bar" aria-hidden>
              <div
                style={{
                  width: `${
                    continueCard.totalCount === 0
                      ? 0
                      : (continueCard.completedCount /
                          continueCard.totalCount) *
                        100
                  }%`,
                }}
              />
            </div>
          </div>
          {continueCard.nextLessonSlug ? (
            <Link
              href={`/courses/${continueCard.courseSlug}/lessons/${continueCard.nextLessonSlug}`}
              className="continue-cta"
              data-testid="continue-cta"
            >
              Resume lesson →
            </Link>
          ) : null}
        </section>
      ) : null}

      <section className="catalog-section" aria-labelledby="catalog-heading">
        <h2 id="catalog-heading" className="section-heading">
          All courses
        </h2>
        {courses.length === 0 ? (
          <div className="empty-state">No courses available yet.</div>
        ) : (
          <ul className="course-list" data-testid="course-list">
            {courses.map((course) => {
              const action = primaryAction(course);
              return (
                <li
                  key={course.id}
                  className="course-card"
                  data-testid={`course-card-${course.slug}`}
                  data-state={course.state}
                >
                  <div className="course-card-header">
                    <h2>{course.title}</h2>
                    <span
                      className={`state-badge state-${course.state}`}
                      data-testid={`state-badge-${course.slug}`}
                    >
                      {stateLabel(course)}
                    </span>
                  </div>
                  <p>{course.description}</p>
                  <div
                    className="muted"
                    style={{ fontSize: 13 }}
                    data-testid={`lesson-count-${course.slug}`}
                  >
                    {course.totalCount} lesson
                    {course.totalCount === 1 ? "" : "s"}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <Link href={action.href} data-testid={action.testId}>
                      {action.label}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
