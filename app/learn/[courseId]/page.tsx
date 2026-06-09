import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { topicVisible } from "../_lib/attempt";
import { setAutoRenew } from "./actions";

export const dynamic = "force-dynamic";

type SubjectFacultyRow = { faculties: { full_name: string } | null };

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

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

  const [{ data: subjects }, { data: subscription }] = await Promise.all([
    supabase
      .from("subjects")
      .select("id, title, order_index, subject_faculty(faculties(full_name))")
      .eq("course_id", course.id)
      .order("order_index")
      .order("title"),
    supabase
      .from("subscriptions")
      .select("id, ends_at, status, auto_renew, plans(tier, name)")
      .eq("student_id", user.id)
      .eq("course_id", course.id)
      .eq("status", "active")
      .order("ends_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

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
  const sub = subscription as
    | { id: string; ends_at: string | null; auto_renew: boolean; plans: { tier: string; name: string } | null }
    | null;
  const topicCount = (topics ?? []).length;

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

      <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
        <p className="crumb">
          <Link href="/dashboard">← Dashboard</Link>
        </p>

        <div className="learn-hero">
          <span className="badge">Course</span>
          <h1>{course.title}</h1>
          <p className="meta">
            {(subjects ?? []).length} subject{(subjects ?? []).length === 1 ? "" : "s"} · {topicCount}{" "}
            topic{topicCount === 1 ? "" : "s"} ·{" "}
            {target ? `filtered to ${target}` : "set your target attempt to filter content"}
          </p>
        </div>

        {/* Access banner */}
        <div className="access-banner">
          {sub ? (
            <>
              <div>
                <div className="lead">✓ {sub.plans?.name ?? sub.plans?.tier ?? "Plan"} active</div>
                <div className="sub">
                  Access until {fmtDate(sub.ends_at)} · auto-renew {sub.auto_renew ? "on" : "off"}
                </div>
              </div>
              <div className="access-actions">
                <form action={setAutoRenew} style={{ margin: 0 }}>
                  <input type="hidden" name="sub_id" value={sub.id} />
                  <input type="hidden" name="course_id" value={course.id} />
                  <input type="hidden" name="on" value={sub.auto_renew ? "false" : "true"} />
                  <button className="btn small secondary" type="submit">
                    {sub.auto_renew ? "Cancel auto-renew" : "Turn on auto-renew"}
                  </button>
                </form>
                <Link className="btn small secondary" href={`/learn/${course.id}/plans`}>
                  View plans
                </Link>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="lead">Unlock every topic in {course.title}</div>
                <div className="sub">
                  Free sections are open now. Choose a plan to unlock revision videos, tests,
                  doubt-solving and live classes.
                </div>
              </div>
              <div className="access-actions">
                <Link className="btn" href={`/learn/${course.id}/plans`}>
                  View plans →
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Subjects → topics */}
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
              <div key={s.id} className="subj-block">
                <div className="subj-head">
                  <h2>{s.title}</h2>
                  {faculty.length > 0 && <span className="subj-faculty">with {faculty.join(", ")}</span>}
                </div>
                {subjTopics.length > 0 ? (
                  <div className="topic-grid">
                    {subjTopics.map((t) => (
                      <Link key={t.id} href={`/learn/topic/${t.id}`} style={{ display: "block" }}>
                        <div className="topic-card">
                          <h3 style={{ fontSize: "1.08rem" }}>{t.title}</h3>
                          {t.valid_from_attempt && (
                            <p className="muted" style={{ fontSize: ".78rem" }}>
                              From {t.valid_from_attempt}
                            </p>
                          )}
                          <span className="go">Open topic →</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="muted" style={{ fontSize: ".9rem", marginTop: 10 }}>
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
