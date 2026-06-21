import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { topicVisible } from "../_lib/attempt";
import { setAutoRenew } from "./actions";
import { addMySubject, removeMySubject } from "../mycourses";

export const dynamic = "force-dynamic";

type SubjectFacultyRow = { faculties: { full_name: string } | null };

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

function fmtMins(mins: number): string {
  const m = Math.max(0, Math.round(mins || 0));
  if (!m) return "0m";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
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
      .select("id, title, order_index, telegram_group_url, subject_faculty(faculties(full_name))")
      .eq("course_id", course.id)
      .order("order_index")
      .order("title"),
    supabase
      .from("subscriptions")
      .select("id, ends_at, auto_renew, subject_id, plans(tier, name), subjects(title)")
      .eq("student_id", user.id)
      .eq("course_id", course.id)
      .eq("status", "active")
      .order("ends_at", { ascending: false }),
  ]);

  const { data: mySubjRows } = await supabase
    .from("my_subjects")
    .select("subject_id")
    .eq("student_id", user.id);
  const mySubjIds = new Set((mySubjRows ?? []).map((r) => r.subject_id as string));

  const subjectIds = (subjects ?? []).map((s) => s.id);
  const { data: topics } = subjectIds.length
    ? await supabase
        .from("topics")
        .select("id, title, subject_id, order_index, valid_from_attempt, valid_to_attempt, amendments_upto, important_qs_rev1, important_qs_rev2")
        .in("subject_id", subjectIds)
        .order("order_index")
        .order("title")
    : { data: [] as never[] };

  // Per-subject summary (classes, revision videos, tests, materials, important
  // questions) + per-topic class-number ranges — the same overview admins see.
  const topicIds2 = (topics ?? []).map((t) => t.id);
  const topicToSubject = new Map((topics ?? []).map((t) => [t.id, t.subject_id as string]));
  const sumClasses = new Map<string, number>(), sumClassMins = new Map<string, number>();
  const sumRev = new Map<string, number>(), sumRevMins = new Map<string, number>();
  const sumMcq = new Map<string, number>(), sumDesc = new Map<string, number>();
  const subjMaterials = new Map<string, Set<string>>();
  const topicRange = new Map<string, { min: number; max: number }>();
  const inc = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
  if (topicIds2.length) {
    const { data: secRows } = await supabase
      .from("sections")
      .select("topic_id, type, config")
      .in("topic_id", topicIds2)
      .eq("is_published", true);
    for (const r of secRows ?? []) {
      const tid = (r as { topic_id: string }).topic_id;
      const sid = topicToSubject.get(tid);
      if (!sid) continue;
      const type = (r as { type: string }).type;
      const cfg = (r as { config?: { duration_minutes?: unknown; class_no?: unknown } }).config ?? {};
      const d = Number(cfg.duration_minutes) || 0;
      if (type === "full_class_video") {
        // Don't count ≤100-min "part" continuations (e.g. 7B) as extra classes.
        const isPart = /[A-Za-z]/.test(String(cfg.class_no ?? ""));
        inc(sumClassMins, sid, d);
        if (!isPart) inc(sumClasses, sid);
        const no = parseInt(String(cfg.class_no ?? "").replace(/\D/g, ""), 10);
        if (Number.isFinite(no) && no > 0) {
          const cur = topicRange.get(tid);
          topicRange.set(tid, { min: Math.min(cur?.min ?? no, no), max: Math.max(cur?.max ?? no, no) });
        }
      } else if (type === "revision_video") { inc(sumRev, sid); inc(sumRevMins, sid, d); }
      else if (type === "mcq_test") inc(sumMcq, sid);
      else if (type === "subjective_test") inc(sumDesc, sid);
    }
    const { data: matRows } = await supabase
      .from("repository_items")
      .select("topic_id, kind")
      .in("topic_id", topicIds2)
      .eq("is_active", true)
      .not("file_url", "is", null);
    for (const r of matRows ?? []) {
      const sid = topicToSubject.get((r as { topic_id: string }).topic_id);
      const k = (r as { kind: string }).kind;
      if (!sid || !k || k === "transcript") continue;
      if (!subjMaterials.has(sid)) subjMaterials.set(sid, new Set());
      subjMaterials.get(sid)!.add(k);
    }
  }
  const MAT_LABEL: Record<string, string> = { book: "📕 Books", question_bank: "📚 Question bank", icai: "🏛️ ICAI", rtp: "📄 RTP", mtp: "📄 MTP", past_papers: "🗂️ Past papers", notes: "📝 Notes" };

  const target = profile?.target_attempt ?? null;
  type Sub = {
    id: string;
    ends_at: string | null;
    auto_renew: boolean;
    subject_id: string | null;
    plans: { tier: string; name: string } | null;
    subjects: { title: string } | null;
  };
  const subs = (subscription as unknown as Sub[] | null) ?? [];
  const wholeCourseSub = subs.find((s) => !s.subject_id) ?? null;
  const accessLabels = subs.map((s) =>
    s.subject_id
      ? `${s.subjects?.title ?? "Subject"} (${s.plans?.name ?? s.plans?.tier ?? "Plan"})`
      : `Whole course (${s.plans?.name ?? s.plans?.tier ?? "Plan"})`,
  );
  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
        <p className="crumb">
          <Link href="/dashboard">← Dashboard</Link>
        </p>

        <div className="learn-hero">
          <span className="badge">📘 Course</span>
          <h1>{course.title}</h1>
          <p className="meta">
            {(subjects ?? []).length} subject{(subjects ?? []).length === 1 ? "" : "s"}
            {" · "}
            {target ? `filtered to ${target}` : "set your target attempt to filter content"}
          </p>
        </div>

        {/* Quiet active-access line for students who have paid — no marketing. */}
        {subs.length > 0 && (
          <div className="access-banner">
            <div>
              <div className="lead">✓ Active access</div>
              <div className="sub">
                {accessLabels.join(" · ")}
                {wholeCourseSub && ` · until ${fmtDate(wholeCourseSub.ends_at)}`}
              </div>
            </div>
            <div className="access-actions">
              {wholeCourseSub && (
                <form action={setAutoRenew} style={{ margin: 0 }}>
                  <input type="hidden" name="sub_id" value={wholeCourseSub.id} />
                  <input type="hidden" name="course_id" value={course.id} />
                  <input type="hidden" name="on" value={wholeCourseSub.auto_renew ? "false" : "true"} />
                  <button className="btn small secondary" type="submit">
                    {wholeCourseSub.auto_renew ? "Cancel auto-renew" : "Turn on auto-renew"}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

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
                <div className="subj-head" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0 }}>{s.title}</h2>
                  {faculty.length > 0 && <span className="subj-faculty">with {faculty.join(", ")}</span>}
                  {mySubjIds.has(s.id) ? (
                    <form action={removeMySubject} style={{ marginLeft: "auto" }}>
                      <input type="hidden" name="subject_id" value={s.id} />
                      <input type="hidden" name="course_id" value={course.id} />
                      <button className="btn small secondary" type="submit">✓ In my subjects · Remove</button>
                    </form>
                  ) : (
                    <form action={addMySubject} style={{ marginLeft: "auto" }}>
                      <input type="hidden" name="subject_id" value={s.id} />
                      <input type="hidden" name="course_id" value={course.id} />
                      <button className="btn small" type="submit">＋ Add to my subjects</button>
                    </form>
                  )}
                </div>
                {mySubjIds.has(s.id) && (s as { telegram_group_url?: string | null }).telegram_group_url && (
                  <a
                    className="btn small secondary"
                    href={(s as { telegram_group_url?: string }).telegram_group_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ background: "#229ED9", color: "#fff", marginBottom: 10, display: "inline-block" }}
                  >
                    ✈️ Join the {s.title} Telegram group
                  </a>
                )}
                {(() => {
                  const subjAll = (topics ?? []).filter((t) => t.subject_id === s.id);
                  const hasRev1 = subjAll.some((t) => ((t as { important_qs_rev1?: string | null }).important_qs_rev1 ?? "").trim());
                  const hasRev2 = subjAll.some((t) => ((t as { important_qs_rev2?: string | null }).important_qs_rev2 ?? "").trim());
                  const attempts = [...new Set(subjAll.map((t) => t.valid_from_attempt).filter(Boolean) as string[])];
                  const mats = [...(subjMaterials.get(s.id) ?? [])].map((k) => MAT_LABEL[k] ?? k);
                  return (
                    <div className="card" style={{ margin: "4px 0 14px" }}>
                      <strong style={{ fontSize: ".95rem" }}>📊 What this subject contains</strong>
                      <div style={{ display: "grid", gap: 6, fontSize: ".9rem", marginTop: 8 }}>
                        <div>🎓 <strong>{sumClasses.get(s.id) ?? 0}</strong> classes · ⏱️ {fmtMins(sumClassMins.get(s.id) ?? 0)} total</div>
                        <div>🎬 <strong>{sumRev.get(s.id) ?? 0}</strong> revision videos · ⏱️ {fmtMins(sumRevMins.get(s.id) ?? 0)} total</div>
                        <div>🧠 <strong>{sumMcq.get(s.id) ?? 0}</strong> MCQ tests · ✍️ <strong>{sumDesc.get(s.id) ?? 0}</strong> descriptive tests</div>
                        <div>📌 Important questions — first revision: {hasRev1 ? "✓" : "—"} · second revision: {hasRev2 ? "✓" : "—"}</div>
                        <div>📚 Materials: {mats.length ? mats.join(" · ") : "coming soon"}</div>
                        <div>📅 Applicable: {attempts.length ? attempts.join(", ") : "all attempts"}</div>
                      </div>
                    </div>
                  );
                })()}
                {subjTopics.length > 0 ? (
                  <div className="topic-grid">
                    {subjTopics.map((t) => (
                      <Link key={t.id} href={`/learn/topic/${t.id}`} style={{ display: "block" }}>
                        <div className="topic-card">
                          <h3 style={{ fontSize: "1.08rem" }}>{t.title}</h3>
                          {(() => {
                            const r = topicRange.get(t.id);
                            if (!r) return null;
                            return (
                              <p className="muted" style={{ fontSize: ".78rem", fontWeight: 600 }}>
                                🎓 {r.min === r.max ? `Class ${r.min}` : `Classes ${r.min}–${r.max}`}
                              </p>
                            );
                          })()}
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
