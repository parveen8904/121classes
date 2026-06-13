import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SubjectFaculty = { faculties: { full_name: string } | null };
type SubjectRow = { id: string; title: string; subject_faculty: SubjectFaculty[] | null };
type CourseRow = { id: string; title: string; subjects: SubjectRow[] | null };

export default async function CoursesPage() {
  const supabase = createClient();
  const { data } = await supabase
    .from("courses")
    .select("id, title, subjects(id, title, subject_faculty(faculties(full_name)))")
    .eq("is_published", true)
    .order("order_index");

  const courses = (data ?? []) as unknown as CourseRow[];

  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">📚 Courses</span>
        <h2>Our courses</h2>
        <p>
          Structured, attempt-wise CA coaching by <strong>CA Parveen Sharma &amp; team</strong> —
          concept classes, revisions, tests and AI-assisted doubt-solving.
        </p>
      </div>

      {courses.length > 0 ? (
        <div className="grid grid-3">
          {courses.map((c) => {
            const faculty = [
              ...new Set(
                (c.subjects ?? []).flatMap((s) =>
                  (s.subject_faculty ?? []).map((sf) => sf.faculties?.full_name).filter(Boolean),
                ),
              ),
            ] as string[];
            return (
              <div className="tile" key={c.id}>
                <div className="ic">📘</div>
                <h3>{c.title}</h3>
                <p className="muted" style={{ fontSize: ".88rem", marginTop: 8 }}>
                  {(c.subjects ?? []).length} subject{(c.subjects ?? []).length === 1 ? "" : "s"}
                  {(c.subjects ?? []).length > 0 && ": "}
                  {(c.subjects ?? []).map((s) => s.title).slice(0, 5).join(", ")}
                </p>
                {faculty.length > 0 && (
                  <p className="muted" style={{ fontSize: ".82rem", marginTop: 8 }}>
                    👨‍🏫 {faculty.join(", ")}
                  </p>
                )}
                <p style={{ marginTop: 14 }}>
                  <Link className="btn small" href="/login">
                    Enrol / view →
                  </Link>
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted" style={{ textAlign: "center" }}>
          📭 Courses are being published — please check back soon.
        </p>
      )}
    </section>
  );
}
