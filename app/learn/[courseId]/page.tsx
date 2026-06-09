import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DURATIONS, computePrice, durationLabel, formatINR } from "@/lib/pricing";
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

  const [{ data: subjects }, { data: subscription }, { data: plans }] = await Promise.all([
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
    supabase
      .from("plans")
      .select("id, tier, name, rank, web_price_inr")
      .eq("is_active", true)
      .order("rank"),
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

        {/* Your access */}
        <div className="card" style={{ marginTop: 20 }}>
          <h3 style={{ marginBottom: 8 }}>Your access</h3>
          {sub ? (
            <>
              <p>
                Active plan: <strong>{sub.plans?.name ?? sub.plans?.tier ?? "Plan"}</strong> · expires{" "}
                {fmtDate(sub.ends_at)} · auto-renew {sub.auto_renew ? "on" : "off"}
              </p>
              <form action={setAutoRenew} style={{ marginTop: 10 }}>
                <input type="hidden" name="sub_id" value={sub.id} />
                <input type="hidden" name="course_id" value={course.id} />
                <input type="hidden" name="on" value={sub.auto_renew ? "false" : "true"} />
                <button className="btn small secondary" type="submit">
                  {sub.auto_renew ? "Cancel auto-renew" : "Turn on auto-renew"}
                </button>
              </form>
            </>
          ) : (
            <p className="muted">
              No active plan for this course yet — free sections are open; paid sections are locked.
            </p>
          )}
        </div>

        {/* Plans */}
        {plans && plans.length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 4 }}>Plans</h3>
            <p className="muted" style={{ fontSize: ".85rem", marginBottom: 14 }}>
              Online checkout opens with payments (Phase 5). For now, ask us to enrol you.
            </p>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
              {plans.map((p) => (
                <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span className="badge">{p.tier}</span>
                    <strong>{p.name}</strong>
                  </div>
                  <ul className="muted" style={{ fontSize: ".85rem", listStyle: "none", padding: 0 }}>
                    {DURATIONS.map((m) => (
                      <li key={m}>
                        {durationLabel(m)}: <strong>{formatINR(computePrice(p.web_price_inr, m))}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

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
