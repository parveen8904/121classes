import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { topicVisible } from "../_lib/attempt";

export const dynamic = "force-dynamic";

type SubjectFacultyRow = { faculties: { full_name: string } | null };

export default async function LearnCourse({ params }: { params: { courseId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/learn/${params.courseId}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("target_attempt")
    .eq("id", user.id)
    .single();

  const { data: course } = await supabase
    .from("courses")
    .select("id, title")
    .eq("id", params.courseId)
    .single();
  if (!course) notFound();

  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, title, order_index, subject_faculty(faculties(full_name))")
    .eq("course_id", course.id)
    .order("order_index")
    .order("title");

  const subjectIds = (subjects ?? []).map((s) => s.id);
  const { data: topics } = subjectIds.length
    ? await supabase
        .from("topics")
        .select("id, title, subject_id, order_index, valid_from_attempt, valid_to_attempt, amendments_upto")
        .in("subject_id", subjectIds)
        .order("order_index")
        .order("title")
    : { data: [] as never[] };

  const target = profile?.target_attempt ?? null;

  return (
    <main>
      <header className="topbar">
        <Link className="logo" href="/">
          1:1 <span>CA Classes</span>
        </Link>
        <Link className="muted" href="/dashboard">
          Dashboard
        </Link>
      </header>

      <section className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
        <p className="muted" style={{ marginBottom: 8 }}>
          <Link className="muted" href="/dashboard">
            ← Dashboard
          </Link>
        </p>
        <span className="badge">Course</span>
        <h1 style={{ margin: "12px 0 6px" }}>{course.title}</h1>
        <p className="muted">
          Target attempt: {target ?? "not set"}
          {target ? " · topics are filtered to your attempt" : " · showing all topics (set your attempt to filter)"}
        </p>

        {subjects && subjects.length > 0 ? (
          subjects.map((s) => {
            const faculty = ((s.subject_faculty ?? []) as unknown as SubjectFacultyRow[])
              .map((sf) => sf.faculties?.full_name)
              .filter(Boolean);
            const subjTopics = (topics ?? []).filter(
              (t) =>
                t.subject_id === s.id &&
                topicVisible(target, t.valid_from_attempt, t.valid_to_attempt),
            );
            return (
              <div key={s.id} style={{ marginTop: 32 }}>
                <h2 style={{ fontSize: "1.25rem", marginBottom: 2 }}>{s.title}</h2>
                {faculty.length > 0 && (
                  <p className="muted" style={{ fontSize: ".85rem", marginBottom: 14 }}>
                    Faculty: {faculty.join(", ")}
                  </p>
                )}
                {subjTopics.length > 0 ? (
                  <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
                    {subjTopics.map((t) => (
                      <Link key={t.id} href={`/learn/topic/${t.id}`} style={{ display: "block" }}>
                        <div className="card" style={{ height: "100%" }}>
                          <h3 style={{ fontSize: "1.05rem" }}>{t.title}</h3>
                          {t.amendments_upto && (
                            <p className="muted" style={{ fontSize: ".78rem", marginTop: 8 }}>
                              Amendments upto {t.amendments_upto}
                            </p>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="muted" style={{ fontSize: ".9rem" }}>
                    No topics for your attempt yet.
                  </p>
                )}
              </div>
            );
          })
        ) : (
          <div className="card" style={{ marginTop: 28 }}>
            <p className="muted">No subjects published yet for this course.</p>
          </div>
        )}
      </section>
    </main>
  );
}
