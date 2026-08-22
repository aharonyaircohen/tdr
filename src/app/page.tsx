import Link from "next/link";
import { listCourses } from "@/lib/service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const courses = await listCourses();
  return (
    <main className="container">
      <header className="page-header">
        <h1>The Digital Reality</h1>
        <span className="muted" data-testid="learner-id">Learner: demo</span>
      </header>
      <p className="muted" style={{ marginTop: -8, marginBottom: 24 }}>
        Pick a course to start learning through chat.
      </p>
      {courses.length === 0 ? (
        <div className="empty-state">No courses available yet.</div>
      ) : (
        <ul className="course-list" data-testid="course-list">
          {courses.map((course) => {
            const target = course.resumeLessonSlug
              ? `/courses/${course.slug}/lessons/${course.resumeLessonSlug}`
              : `/courses/${course.slug}`;
            return (
              <li key={course.id} className="course-card">
                <h2>{course.title}</h2>
                <p>{course.description}</p>
                <div className="muted" style={{ fontSize: 13 }}>
                  {course.lessons.length} lesson
                  {course.lessons.length === 1 ? "" : "s"}
                </div>
                <div style={{ marginTop: 12 }}>
                  <Link
                    href={target}
                    data-testid={`open-course-${course.slug}`}
                  >
                    Open course →
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}