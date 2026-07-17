import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { topicVisible, effectiveAttemptWindow } from "../_lib/attempt";
import { setAutoRenew } from "./actions";
import { addMySubject, removeMySubject } from "../mycourses";
import AskDoubts from "./AskDoubts";
import { fmtMins, fmtAt125, AT125_NOTE } from "@/lib/duration";

export const dynamic = "force-dynamic";

type SubjectFacultyRow = { faculties: { full_name: string; phone: string | null; email: string | null } | null };

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

  // One parallel round trip for everything that only needs the user + course id
  // (was 4 sequential trips — the main cause of the slow click into a course).
  const [{ data: profile }, { data: course }, { data: subjects }, { data: subscription }, { data: mySubjRows }] = await Promise.all([
    supabase.from("profiles").select("target_attempt").eq("id", user.id).single(),
    supabase.from("courses").select("id, title").eq("id", params.courseId).single(),
    supabase
      .from("subjects")
      .select("id, title, order_index, telegram_group_url, valid_from_attempt, valid_to_attempt, subject_faculty(faculties(full_name, phone, email))")
      .eq("course_id", params.courseId)
      .order("order_index")
      .order("title"),
    supabase
      .from("subscriptions")
      .select("id, ends_at, auto_renew, subject_id, plans(tier, name), subjects(title)")
      .eq("student_id", user.id)
      .eq("course_id", params.courseId)
      .eq("status", "active")
      .order("ends_at", { ascending: false }),
    supabase.from("my_subjects").select("subject_id").eq("student_id", user.id),
  ]);
  if (!course) notFound();
  const mySubjIds = new Set((mySubjRows ?? []).map((r) => r.subject_id as string));

  const subjectIds = (subjects ?? []).map((s) => s.id);
  // Global applicability per subject; each topic inherits it unless it overrides.
  const subjWindow = new Map(
    (subjects ?? []).map((s) => [
      s.id as string,
      {
        from: (s as { valid_from_attempt?: string | null }).valid_from_attempt ?? null,
        to: (s as { valid_to_attempt?: string | null }).valid_to_attempt ?? null,
      },
    ]),
  );
  const topicWindow = (t: { subject_id: string | null; valid_from_attempt?: string | null; valid_to_attempt?: string | null }) => {
    const sw = subjWindow.get((t.subject_id as string) ?? "") ?? { from: null, to: null };
    return effectiveAttemptWindow(t.valid_from_attempt, t.valid_to_attempt, sw.from, sw.to);
  };
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
  const topicClassCount = new Map<string, number>(); // non-part classes per topic
  const topicMins = new Map<string, number>(); // total class minutes per topic
  const inc = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
  // Catalog totals (classes / hours / tests) are the SAME for everyone — they
  // describe what the subject contains, not what this student has unlocked. So we
  // count via the service client (all published sections), never RLS (which would
  // show a not-yet-subscribed student only the free preview). Access to the actual
  // content is still enforced when a class is opened.
  const svc = createServiceClient();
  // Subject-level resources (custom content, RTP/MTP/past papers uploaded at the
  // subject — not topic — level) that are student-visible.
  const { data: subjResRows } = subjectIds.length
    ? await svc
        .from("repository_items")
        .select("id, subject_id, kind, title, file_url, valid_from_attempt, valid_to_attempt")
        .in("subject_id", subjectIds)
        .is("topic_id", null)
        .eq("is_active", true)
        .eq("student_visible", true)
        .not("file_url", "is", null)
        .order("created_at", { ascending: false })
    : { data: [] as never[] };
  const subjResources = new Map<string, { id: string; kind: string; title: string; file_url: string; valid_from_attempt: string | null; valid_to_attempt: string | null }[]>();
  for (const r of (subjResRows ?? []) as { id: string; subject_id: string; kind: string; title: string; file_url: string; valid_from_attempt: string | null; valid_to_attempt: string | null }[]) {
    const arr = subjResources.get(r.subject_id) ?? [];
    arr.push(r); subjResources.set(r.subject_id, arr);
  }
  // Published case-study sets per subject (scenario + MCQs practice).
  const { data: caseSetRows } = subjectIds.length
    ? await svc.from("case_sets").select("id, subject_id, title").in("subject_id", subjectIds).eq("status", "ready").eq("is_published", true).order("created_at", { ascending: false })
    : { data: [] as never[] };
  const subjCaseSets = new Map<string, { id: string; title: string }[]>();
  for (const r of (caseSetRows ?? []) as { id: string; subject_id: string; title: string }[]) {
    const arr = subjCaseSets.get(r.subject_id) ?? [];
    arr.push(r); subjCaseSets.set(r.subject_id, arr);
  }
  // Total case scenarios per subject (for the "what's uploaded" highlight).
  const caseSetToSubject = new Map((caseSetRows ?? []).map((r) => [r.id as string, (r as { subject_id: string }).subject_id]));
  const subjCaseCount = new Map<string, number>();
  const caseSetIds = (caseSetRows ?? []).map((r) => r.id as string);
  if (caseSetIds.length) {
    const { data: csRows } = await svc.from("case_studies").select("set_id").in("set_id", caseSetIds);
    for (const r of (csRows ?? []) as { set_id: string }[]) {
      const sid = caseSetToSubject.get(r.set_id);
      if (sid) subjCaseCount.set(sid, (subjCaseCount.get(sid) ?? 0) + 1);
    }
  }
  // Count subject-level materials by kind (MTP / RTP / past papers) for the badge line.
  const subjMatCount = (sid: string, kind: string) => (subjResources.get(sid) ?? []).filter((r) => r.kind === kind).length;
  if (topicIds2.length) {
    const [{ data: secRows }, { data: matRowsP }] = await Promise.all([
      // Only the two tiny config keys we need — configs also hold transcripts
      // (megabytes across a course), which made this page take seconds.
      svc.from("sections").select("topic_id, type, duration_minutes:config->>duration_minutes, class_no:config->>class_no").in("topic_id", topicIds2).eq("is_published", true),
      svc.from("repository_items").select("topic_id, kind").in("topic_id", topicIds2).eq("is_active", true).not("file_url", "is", null),
    ]);
    for (const r of secRows ?? []) {
      const tid = (r as { topic_id: string }).topic_id;
      const sid = topicToSubject.get(tid);
      if (!sid) continue;
      const type = (r as { type: string }).type;
      const row = r as { duration_minutes?: string | null; class_no?: string | null };
      const d = Number(row.duration_minutes) || 0;
      if (type === "full_class_video") {
        // Don't count ≤100-min "part" continuations (e.g. 7B) as extra classes.
        const isPart = /[A-Za-z]/.test(String(row.class_no ?? ""));
        inc(sumClassMins, sid, d);
        inc(topicMins, tid, d);
        if (!isPart) { inc(sumClasses, sid); inc(topicClassCount, tid); }
      } else if (type === "revision_video") { inc(sumRev, sid); inc(sumRevMins, sid, d); }
      else if (type === "mcq_test") inc(sumMcq, sid);
      else if (type === "subjective_test") inc(sumDesc, sid);
    }
    const matRows = matRowsP;
    for (const r of matRows ?? []) {
      const sid = topicToSubject.get((r as { topic_id: string }).topic_id);
      const k = (r as { kind: string }).kind;
      if (!sid || !k || k === "transcript") continue;
      if (!subjMaterials.has(sid)) subjMaterials.set(sid, new Set());
      subjMaterials.get(sid)!.add(k);
    }
  }
  const MAT_LABEL: Record<string, string> = { book: "📕 Book", question_bank: "📚 Question bank", icai: "🏛️ ICAI material", rtp: "📝 RTP", mtp: "📝 MTP", past_papers: "🗂️ Past exam papers", notes: "✍️ Handwritten notes/book", custom: "✨ Additional resources" };
  // "Subject resources" tiles — display order + icon/short label per type.
  const RES_ORDER: { kind: string; icon: string; label: string }[] = [
    { kind: "notes", icon: "✍️", label: "Handwritten" },
    { kind: "book", icon: "📕", label: "Book" },
    { kind: "question_bank", icon: "📚", label: "Question bank" },
    { kind: "past_papers", icon: "🗂️", label: "Past paper" },
    { kind: "rtp", icon: "📝", label: "RTP" },
    { kind: "mtp", icon: "📝", label: "MTP" },
    { kind: "custom", icon: "✨", label: "Resource" },
  ];
  // Fuller category names for the resource drill-down headers.
  const RES_CAT_LABEL: Record<string, string> = {
    notes: "Handwritten notes / book", book: "Books", question_bank: "Question bank",
    past_papers: "Past exam papers", rtp: "RTPs — Revision Test Papers", mtp: "MTPs — Mock Test Papers",
    custom: "Additional resources",
  };

  // Community links shown on each subject (channel + Discord are the same for all;
  // the Telegram GROUP is per-subject from subjects.telegram_group_url).
  const { data: linkRows } = await supabase.from("site_settings").select("key, value").in("key", ["support_telegram", "support_discord"]);
  const linkMap = new Map((linkRows ?? []).map((r) => [r.key, r.value as string]));
  const tgChannel = linkMap.get("support_telegram") || "";
  const dcLink = linkMap.get("support_discord") || "";

  const target = profile?.target_attempt ?? null;

  // Default applicability shown when a subject has no explicit window set — by
  // course level. The admin overrides per subject anytime (subject applicability).
  const courseLevelDefault = (() => {
    const t = (course.title || "").toLowerCase();
    if (t.includes("final")) return { from: "November 2026", to: "November 2028" };
    if (t.includes("inter")) return { from: "September 2026", to: "May 2028" };
    return null;
  })();

  // Continuous class numbering across a subject's topics, in display order:
  // topic 1 → "Classes 1 to 10", topic 2 → "Classes 11 to 15", etc. Based on how
  // many (non-part) classes each topic has, so it doesn't depend on stored class_no.
  const topicClassRange = new Map<string, { start: number; end: number }>();
  for (const s of subjects ?? []) {
    const ordered = (topics ?? []).filter((t) => {
      if (t.subject_id !== s.id) return false;
      const w = topicWindow(t);
      return topicVisible(target, w.from, w.to);
    });
    let running = 0;
    for (const t of ordered) {
      const cnt = topicClassCount.get(t.id) ?? 0;
      if (cnt > 0) {
        topicClassRange.set(t.id, { start: running + 1, end: running + cnt });
        running += cnt;
      }
    }
  }

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

        {/* Compact course header — the subject banners below are the prominent part. */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <span className="badge">📘 Course</span>
          <h1 style={{ fontSize: "1.25rem", margin: 0 }}>{course.title}</h1>
          <span className="muted" style={{ fontSize: ".82rem" }}>
            {(subjects ?? []).length} subject{(subjects ?? []).length === 1 ? "" : "s"}
            {" · "}
            {target ? `filtered to ${target}` : "set your target attempt to filter content"}
          </span>
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
            const facultyRows = ((s.subject_faculty ?? []) as unknown as SubjectFacultyRow[])
              .map((sf) => sf.faculties)
              .filter((f): f is NonNullable<SubjectFacultyRow["faculties"]> => !!f);
            const faculty = facultyRows.map((f) => f.full_name).filter(Boolean);
            const facultyContacts = facultyRows.filter((f) => f.phone || f.email);
            const subjTopics = (topics ?? []).filter((t) => {
              if (t.subject_id !== s.id) return false;
              const w = topicWindow(t);
              return topicVisible(target, w.from, w.to);
            });
            return (
              <div key={s.id} className="subj-block">
                {/* Prominent subject banner — carries the faculty contact. */}
                <div style={{ border: "2px solid var(--accent)", background: "var(--bg-soft)", borderRadius: 12, padding: "16px 18px", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: "1.6rem" }}>{s.title}</h2>
                      {faculty.length > 0 && <span className="subj-faculty">with {faculty.join(", ")}</span>}
                    </div>
                    {mySubjIds.has(s.id) ? (
                      <form action={removeMySubject} style={{ margin: 0 }}>
                        <input type="hidden" name="subject_id" value={s.id} />
                        <input type="hidden" name="course_id" value={course.id} />
                        <button className="btn small secondary" type="submit">✓ In my subjects · Remove</button>
                      </form>
                    ) : (
                      <form action={addMySubject} style={{ margin: 0 }}>
                        <input type="hidden" name="subject_id" value={s.id} />
                        <input type="hidden" name="course_id" value={course.id} />
                        <button className="btn small" type="submit">＋ Add to my subjects</button>
                      </form>
                    )}
                  </div>
                  {/* Ask your doubts — AI answers instantly; faculty only if not satisfied. */}
                  <div style={{ marginTop: 12 }}>
                    <AskDoubts
                      subjectId={s.id}
                      subjectTitle={s.title}
                      facultyPhone={facultyContacts.find((f) => f.phone)?.phone ?? null}
                      facultyEmail={facultyContacts.find((f) => f.email)?.email ?? null}
                    />
                    <p className="muted" style={{ fontSize: ".78rem", margin: "8px 0 0" }}>
                      ⚡ Instant reply from your class material.
                    </p>
                    {facultyContacts.length > 0 && (
                      <p style={{ fontSize: ".78rem", margin: "6px 0 0", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        {facultyContacts.map((f) => {
                          const wa = (f.phone ?? "").replace(/\D/g, "").slice(-10);
                          return (
                            <span key={f.full_name} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                              <span className="muted">👩‍🏫 {f.full_name}:</span>
                              {wa.length === 10 && (
                                <a href={`https://wa.me/91${wa}`} target="_blank" rel="noopener noreferrer" style={{ color: "#25D366", fontWeight: 700 }}>💬 WhatsApp</a>
                              )}
                              {f.email && <a href={`mailto:${f.email}`} style={{ color: "var(--accent)", fontWeight: 700 }}>✉️ Email</a>}
                            </span>
                          );
                        })}
                      </p>
                    )}
                  </div>
                </div>
                {mySubjIds.has(s.id) && ((s as { telegram_group_url?: string | null }).telegram_group_url || tgChannel || dcLink) && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    {(s as { telegram_group_url?: string | null }).telegram_group_url && (
                      <a className="btn small" href={(s as { telegram_group_url?: string }).telegram_group_url} target="_blank" rel="noopener noreferrer" style={{ background: "#229ED9", color: "#fff" }}>
                        👥 Join {s.title} group
                      </a>
                    )}
                    {tgChannel && (
                      <a className="btn small" href={tgChannel} target="_blank" rel="noopener noreferrer" style={{ background: "#229ED9", color: "#fff" }}>
                        ✈️ Telegram channel
                      </a>
                    )}
                    {dcLink && (
                      <a className="btn small" href={dcLink} target="_blank" rel="noopener noreferrer" style={{ background: "#5865F2", color: "#fff" }}>
                        🎮 Discord
                      </a>
                    )}
                  </div>
                )}
                {(() => {
                  const subjAll = (topics ?? []).filter((t) => t.subject_id === s.id);
                  const hasRev1 = subjAll.some((t) => ((t as { important_qs_rev1?: string | null }).important_qs_rev1 ?? "").trim());
                  const hasRev2 = subjAll.some((t) => ((t as { important_qs_rev2?: string | null }).important_qs_rev2 ?? "").trim());
                  const swRaw = subjWindow.get(s.id) ?? { from: null, to: null };
                  // Fall back to the course-level default when nothing is set;
                  // an explicit subject applicability always overrides it.
                  const sw = swRaw.from ? swRaw : (courseLevelDefault ?? swRaw);
                  // Never open-ended "onwards" — show the range, or just "from X".
                  const applicable = sw.from ? (sw.to ? `${sw.from} up to ${sw.to}` : `from ${sw.from}`) : "";
                  // Topics that actually carry classes (for "137 classes in X topics").
                  const nTopics = subjTopics.filter((t) => (topicClassCount.get(t.id) ?? 0) > 0).length;
                  // Materials line = everything EXCEPT the practice papers (shown on
                  // their own line) — from both topic-level and subject-level uploads.
                  const paperKinds = new Set(["mtp", "rtp", "past_papers"]);
                  const allKinds = new Set<string>([
                    ...(subjMaterials.get(s.id) ?? []),
                    ...((subjResources.get(s.id) ?? []).map((r) => r.kind)),
                  ]);
                  // Materials line = material TYPES only (handwritten notes/book,
                  // question bank, ICAI…). Custom items appear as their own named
                  // tiles in Subject resources, so we don't list their titles here.
                  const mats = [...allKinds].filter((k) => !paperKinds.has(k) && k !== "transcript" && k !== "custom").map((k) => MAT_LABEL[k] ?? k);
                  const nMtp = subjMatCount(s.id, "mtp");
                  const nRtp = subjMatCount(s.id, "rtp");
                  const nPast = subjMatCount(s.id, "past_papers");
                  const nCases = subjCaseCount.get(s.id) ?? 0;
                  const nCaseSets = (subjCaseSets.get(s.id) ?? []).length;
                  // Counts kept as data so we can bold the NUMBERS in the render.
                  const paperItems = [
                    nMtp > 0 && { n: nMtp, unit: `MTP${nMtp === 1 ? "" : "s"}` },
                    nRtp > 0 && { n: nRtp, unit: `RTP${nRtp === 1 ? "" : "s"}` },
                    nPast > 0 && { n: nPast, unit: `past exam paper${nPast === 1 ? "" : "s"}` },
                  ].filter(Boolean) as { n: number; unit: string }[];
                  return (
                    <div className="card" style={{ margin: "4px 0 14px" }}>
                      <strong style={{ fontSize: ".95rem" }}>📊 What this subject contains</strong>
                      <div style={{ display: "grid", gap: 6, fontSize: ".9rem", marginTop: 8 }}>
                        <div>🎓 <strong>{sumClasses.get(s.id) ?? 0}</strong> classes in <strong>{nTopics}</strong> topic{nTopics === 1 ? "" : "s"} · ⏱️ {fmtAt125(sumClassMins.get(s.id) ?? 0)} total <span className="muted" style={{ fontSize: ".82rem" }}>{AT125_NOTE}</span></div>
                        <div>🎬 <strong>{sumRev.get(s.id) ?? 0}</strong> revision videos · ⏱️ {fmtMins(sumRevMins.get(s.id) ?? 0)} total</div>
                        <div>🧠 <strong>{sumMcq.get(s.id) ?? 0}</strong> MCQ tests · ✍️ <strong>{sumDesc.get(s.id) ?? 0}</strong> descriptive tests</div>
                        {paperItems.length > 0 && (
                          <div>📄 Practice papers: {paperItems.map((p, i) => (
                            <span key={p.unit}>{i > 0 ? " · " : ""}<strong>{p.n}</strong> {p.unit}</span>
                          ))}</div>
                        )}
                        {nCases > 0 && <div>🧩 <strong>{nCases}</strong> case scenario{nCases === 1 ? "" : "s"}{nCaseSets > 1 ? ` (${nCaseSets} sets)` : ""} — practise below</div>}
                        <div>📌 Important-question lists — First revision: <strong>{hasRev1 ? "✓ available" : "— not added"}</strong> · Second revision: <strong>{hasRev2 ? "✓ available" : "— not added"}</strong></div>
                        <div>📚 Materials: {mats.length ? mats.join(" · ") : "coming soon"}</div>
                        <div>📅 Applicable {applicable || "for all attempts"}</div>
                      </div>
                      {/* Turn all of the above into a day-by-day schedule. */}
                      <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: ".88rem" }}>🗓️ Fit every class, revision, test &amp; paper above into a personal day-by-day plan:</span>
                        <Link className="btn small" href={`/planner?subject=${s.id}`}>Build your plan →</Link>
                      </div>
                    </div>
                  );
                })()}
                {(subjCaseSets.get(s.id) ?? []).length > 0 && (
                  <div className="card" style={{ margin: "0 0 14px" }}>
                    <strong style={{ fontSize: ".95rem" }}>🧩 Case scenarios (new exam pattern)</strong>
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      {(subjCaseSets.get(s.id) ?? []).map((cset) => (
                        <Link key={cset.id} href={`/learn/cases/${cset.id}`} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, color: "var(--text)", border: "2px solid var(--accent)" }}>
                          <span style={{ fontWeight: 700 }}>🧩 {cset.title}</span>
                          <span style={{ color: "var(--accent)", fontWeight: 700, whiteSpace: "nowrap" }}>Practise cases →</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                {(subjResources.get(s.id) ?? []).length > 0 && (
                  <div style={{ margin: "0 0 14px" }}>
                    <strong style={{ fontSize: ".95rem" }}>📚 Subject resources</strong>
                    <p className="muted" style={{ fontSize: ".78rem", margin: "2px 0 8px" }}>Tap a category to open its papers / notes.</p>
                    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                      {/* Standard categories → tap to open their papers/notes. */}
                      {RES_ORDER.filter((cat) => cat.kind !== "custom").map((cat) => {
                        const rows = (subjResources.get(s.id) ?? []).filter((r) => r.kind === cat.kind);
                        if (rows.length === 0) return null;
                        const catLabel = RES_CAT_LABEL[cat.kind] ?? cat.label;
                        return (
                          <details key={cat.kind} style={{ border: "2px solid var(--accent)", borderRadius: 12, background: "var(--bg-soft)", overflow: "hidden" }}>
                            <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", fontWeight: 700 }}>
                              <span style={{ fontSize: "1.4rem", lineHeight: 1 }}>{cat.icon}</span>
                              <span style={{ flex: 1, fontSize: ".9rem" }}>{catLabel}</span>
                              <span style={{ background: "var(--accent)", color: "#fff", borderRadius: 999, padding: "1px 10px", fontSize: ".8rem" }}>{rows.length}</span>
                            </summary>
                            <div style={{ display: "grid", gap: 6, padding: "0 12px 12px" }}>
                              {rows.map((r) => {
                                const isVideo = /youtu\.be|youtube\.com|vimeo|\.mp4($|\?)|iframe\.mediadelivery/i.test(r.file_url);
                                const isPaper = ["mtp", "rtp", "past_papers"].includes(r.kind);
                                const href = isPaper ? `/learn/paper/${r.id}` : r.file_url;
                                return (
                                  <a key={r.id} href={href} target={isPaper ? undefined : "_blank"} rel="noopener noreferrer" style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", background: "var(--card)", borderRadius: 8, padding: "8px 12px", color: "var(--text)" }}>
                                    <span style={{ fontSize: ".88rem" }}><strong>{r.title}</strong>{r.valid_from_attempt ? <span className="muted"> · {r.valid_from_attempt}{r.valid_to_attempt ? ` up to ${r.valid_to_attempt}` : ""}</span> : null}</span>
                                    <span style={{ color: "var(--accent)", fontWeight: 700, whiteSpace: "nowrap", fontSize: ".82rem" }}>{isPaper ? "Attempt →" : isVideo ? "Watch →" : "Open →"}</span>
                                  </a>
                                );
                              })}
                            </div>
                          </details>
                        );
                      })}
                      {/* Custom content → each item is its OWN tile, named exactly as uploaded. */}
                      {(subjResources.get(s.id) ?? []).filter((r) => r.kind === "custom").map((r) => {
                        const isVideo = /youtu\.be|youtube\.com|vimeo|\.mp4($|\?)|iframe\.mediadelivery/i.test(r.file_url);
                        return (
                          <a key={r.id} href={r.file_url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", flexDirection: "column", gap: 6, border: "2px solid var(--accent)", borderRadius: 12, background: "var(--bg-soft)", padding: "12px 14px", color: "var(--text)", minHeight: 84 }}>
                            <span style={{ fontSize: "1.4rem", lineHeight: 1 }}>{isVideo ? "🎬" : "📄"}</span>
                            <span style={{ fontSize: ".9rem", fontWeight: 700, lineHeight: 1.25 }}>{r.title}</span>
                            <span style={{ marginTop: "auto", color: "var(--accent)", fontWeight: 700, fontSize: ".82rem" }}>{isVideo ? "Watch →" : "Open →"}</span>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}
                {subjTopics.length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {subjTopics.map((t) => {
                      const r = topicClassRange.get(t.id);
                      return (
                        <Link
                          key={t.id}
                          href={`/learn/topic/${t.id}`}
                          className="card"
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, color: "var(--text)" }}
                        >
                          <span style={{ fontSize: "1.08rem", fontWeight: 700 }}>
                            {t.title}
                            {(t as { amendments_upto?: string | null }).amendments_upto && (
                              <span className="muted" style={{ fontSize: ".78rem", fontWeight: 400, marginLeft: 8 }}>
                                📝 Amended up to {(t as { amendments_upto?: string }).amendments_upto}
                              </span>
                            )}
                          </span>
                          <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            {r && (
                              <span className="muted" style={{ display: "block", fontSize: ".92rem", fontWeight: 400, fontStyle: "italic" }}>
                                {r.start === r.end ? `Class ${r.start}` : `Classes ${r.start} to ${r.end}`}
                              </span>
                            )}
                            {(topicMins.get(t.id) ?? 0) > 0 && (
                              <span className="muted" style={{ display: "block", fontSize: ".82rem", fontWeight: 400 }}>
                                ⏱️ {fmtMins(topicMins.get(t.id) ?? 0)}
                              </span>
                            )}
                          </span>
                        </Link>
                      );
                    })}
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
