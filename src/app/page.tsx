import Link from "next/link";
import { cookies } from "next/headers";
import { getLearnerDashboard, type CourseSummary } from "@/lib/service";
import { getCurrentLearnerId } from "@/lib/learner";
import { buildLaunchAssertion } from "@/lib/kody-jwt";
import {
  kodyLaunchUrl,
  kodyTenant,
  kodyTenantOwner,
  kodyTenantRepo,
  kodyBrandSlug,
} from "@/lib/kody-launch";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/lib/auth";

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
  const learnerId = await getCurrentLearnerId();

  // Was this request authenticated via a session cookie (vs. the env-var
  // fallback)? The cookie is the signal we use to decide whether to render
  // the launch form or a "sign in" link.
  let displayLabel = "demo";
  let signedInLearner: { id: string; email: string } | null = null;
  let sessionLearnerId: string | null = null;
  try {
    const jar = await cookies();
    const cookie = jar.get(SESSION_COOKIE_NAME)?.value ?? null;
    sessionLearnerId = await verifySessionCookie(cookie);
  } catch {
    sessionLearnerId = null;
  }
  if (sessionLearnerId) {
    signedInLearner = await prisma.learner
      .findUnique({
        where: { id: sessionLearnerId },
        select: { id: true, email: true },
      })
      .catch(() => null);
    if (signedInLearner) {
      displayLabel = signedInLearner.email;
    }
  }
  if (signedInLearner) {
    displayLabel = signedInLearner.email;
  }

  // The Kody launch assertion is minted fresh on every render so each click
  // produces a brand-new `jti`. Kody enforces single-use on its side.
  const assertion = signedInLearner
    ? await buildLaunchAssertion({ learnerId })
    : null;

  return (
    <main className="container">
      <header className="page-header">
        <h1>The Digital Reality</h1>
        <span className="muted" data-testid="learner-id">
          Learner: {displayLabel}
        </span>
      </header>
      <p className="muted" style={{ marginTop: -8, marginBottom: 24 }}>
        Pick a course to start learning through chat.
      </p>

      {assertion ? (
        <section
          className="continue-card"
          data-testid="kody-launch-card"
          aria-labelledby="kody-launch-heading"
        >
          <div className="continue-eyebrow">Kody Brand Chat</div>
          <h2 id="kody-launch-heading" className="continue-title">
            Hand off to Kody
          </h2>
          <p className="muted continue-next">
            Open a scoped chat session with Kody using a single-use signed
            assertion (RS256, 5-minute TTL).
          </p>
          <form
            method="POST"
            action={kodyLaunchUrl()}
            data-testid="kody-launch-form"
          >
            <input type="hidden" name="assertion" value={assertion} />
            <input
              type="hidden"
              name="owner"
              value={kodyTenantOwner()}
            />
            <input type="hidden" name="repo" value={kodyTenantRepo()} />
            <input
              type="hidden"
              name="brandSlug"
              value={kodyBrandSlug()}
            />
            <button
              type="submit"
              className="continue-cta"
              data-testid="open-kody-chat"
            >
              Open Kody Chat →
            </button>
          </form>
          <p
            className="muted"
            style={{ fontSize: 12, marginTop: 12 }}
            data-testid="kody-launch-meta"
          >
            tenant <code data-testid="kody-launch-tenant">{kodyTenant()}</code>{" "}
            · brand <code data-testid="kody-launch-brand">{kodyBrandSlug()}</code>
          </p>
        </section>
      ) : (
        <section
          className="continue-card"
          data-testid="kody-signin-card"
          aria-labelledby="kody-signin-heading"
        >
          <div className="continue-eyebrow">Kody Brand Chat</div>
          <h2 id="kody-signin-heading" className="continue-title">
            Chat with Kody
          </h2>
          <p className="muted continue-next">
            Sign in to mint a short-lived assertion that Kody can verify
            before opening your chat session.
          </p>
          <Link
            href="/login"
            className="continue-cta"
            data-testid="open-kody-chat"
          >
            Sign in to chat with Kody →
          </Link>
        </section>
      )}

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