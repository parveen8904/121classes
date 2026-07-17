import Link from "next/link";
import { tryServiceClient } from "@/lib/supabase/service";
import CountUp from "@/app/components/CountUp";
import { studentsTaught } from "@/lib/studentsTaught";

// Public marketing page (service client only, no cookies/auth) — serve it from
// the cache and refresh every 5 minutes instead of hitting the DB on every view.
// This was the slowest page on the site (~6s); cached it returns instantly.
export const revalidate = 300;
export const metadata = {
  title: "Courses — CA Parveen Sharma",
  description: "Advanced Accounting & Financial Reporting — fully guided: classes, day-by-day planner, AI doubt-solving on WhatsApp/Telegram, tests with performance reports, revisions, notes and amendments updated to your exam.",
};

const dur = (c: any) => Number(c?.duration_minutes) || 0;
// Hours shown at the recommended 1.25× watch speed (actual watch time).
const hrs = (mins: number) => {
  const m = Math.round((mins || 0) / 1.25);
  const h = Math.round(m / 60);
  return h > 0 ? `${h} hr${h === 1 ? "" : "s"}` : `${m} min`;
};
const GRAD = "linear-gradient(135deg,#0d9488,#10b981)";

type Stat = { classes: number; minutes: number; revisions: number; tests: number; notes: number; topics: number; amendments: number; attempts: string[]; faculty: string[]; course: string };

export default async function CoursesPage() {
  const svc = tryServiceClient();
  if (!svc) return null; // local build without env — Vercel always has it

  const { data: courses } = await svc.from("courses").select("id, title").eq("is_published", true).eq("is_test_series", false);
  const courseIds = (courses ?? []).map((c) => c.id as string);
  const courseTitle = new Map((courses ?? []).map((c) => [c.id as string, c.title as string]));

  const { data: subjects } = courseIds.length
    ? await svc.from("subjects").select("id, title, code, course_id, valid_from_attempt, valid_to_attempt, subject_faculty(faculties(full_name))").in("course_id", courseIds).order("order_index")
    : { data: [] as any[] };

  const subjectIds = (subjects ?? []).map((s) => s.id as string);
  const { data: topics } = subjectIds.length
    ? await svc.from("topics").select("id, subject_id").eq("is_published", true).eq("is_combined", false).in("subject_id", subjectIds)
    : { data: [] as any[] };
  const topicSubject = new Map((topics ?? []).map((t) => [t.id as string, t.subject_id as string]));
  const topicIds = (topics ?? []).map((t) => t.id as string);

  const { data: sections } = topicIds.length
    ? await svc.from("sections").select("topic_id, type, config").eq("is_published", true).in("topic_id", topicIds)
    : { data: [] as any[] };

  const { data: amendments } = subjectIds.length
    ? await svc.from("amendments").select("subject_id, valid_from_attempt").eq("is_published", true).in("subject_id", subjectIds)
    : { data: [] as any[] };

  // Practice papers (MTP/RTP/past) and case scenarios per subject — the marketing
  // depth of content. Papers can be at subject OR topic level.
  const { data: repoRows } = subjectIds.length
    ? await svc.from("repository_items").select("subject_id, topic_id, kind").eq("is_active", true).in("kind", ["mtp", "rtp", "past_papers"])
    : { data: [] as any[] };
  const papersBySubject = new Map<string, number>();
  for (const r of repoRows ?? []) {
    const sid = (r as any).subject_id || topicSubject.get((r as any).topic_id);
    if (sid && subjectIds.includes(sid)) papersBySubject.set(sid, (papersBySubject.get(sid) ?? 0) + 1);
  }
  const { data: caseSetRows } = subjectIds.length
    ? await svc.from("case_sets").select("id, subject_id").eq("status", "ready").eq("is_published", true).in("subject_id", subjectIds)
    : { data: [] as any[] };
  const caseSetSub = new Map((caseSetRows ?? []).map((r: any) => [r.id, r.subject_id]));
  const casesBySubject = new Map<string, number>();
  const caseSetIds = (caseSetRows ?? []).map((r: any) => r.id);
  if (caseSetIds.length) {
    const { data: cs } = await svc.from("case_studies").select("set_id").in("set_id", caseSetIds);
    for (const r of cs ?? []) { const sid = caseSetSub.get((r as any).set_id); if (sid) casesBySubject.set(sid, (casesBySubject.get(sid) ?? 0) + 1); }
  }
  const levelDefault = (courseTitleLower: string) =>
    courseTitleLower.includes("final") ? "November 2026 up to November 2028"
    : courseTitleLower.includes("inter") ? "September 2026 up to May 2028" : "";

  const { data: results } = await svc.from("results").select("student_name, headline, attempt, marks, photo_url, quote, level").eq("is_published", true).order("order_index").limit(60);

  // Top result photos grouped by level (CA Final / CA Intermediate) for the cards.
  const photosByLevel = new Map<string, { photo_url: string; student_name: string; headline: string }[]>();
  for (const r of results ?? []) {
    if (!r.photo_url) continue;
    const lvl = (r.level as string) || "";
    const arr = photosByLevel.get(lvl) ?? [];
    if (arr.length < 10) { arr.push({ photo_url: r.photo_url as string, student_name: r.student_name as string, headline: (r.headline as string) ?? "" }); photosByLevel.set(lvl, arr); }
  }

  // Aggregate per subject.
  const stats = new Map<string, Stat>();
  for (const s of subjects ?? []) {
    const faculty = [...new Set(((s as any).subject_faculty ?? []).map((sf: any) => sf.faculties?.full_name).filter(Boolean))] as string[];
    stats.set(s.id as string, { classes: 0, minutes: 0, revisions: 0, tests: 0, notes: 0, topics: 0, amendments: 0, attempts: [], faculty, course: courseTitle.get(s.course_id as string) || "" });
  }
  for (const t of topics ?? []) { const st = stats.get(t.subject_id as string); if (st) st.topics++; }
  for (const sec of sections ?? []) {
    const sid = topicSubject.get(sec.topic_id as string);
    const st = sid ? stats.get(sid) : null;
    if (!st) continue;
    const c = (sec.config ?? {}) as any;
    // "Part" continuations (e.g. 7B) add their minutes but aren't a separate class.
    if (sec.type === "full_class_video") { if (!/[A-Za-z]/.test(String(c.class_no ?? ""))) st.classes++; st.minutes += dur(c); }
    else if (sec.type === "revision_video") st.revisions++;
    else if (sec.type === "mcq_test" || sec.type === "subjective_test") st.tests++;
    if (sec.type === "pdf" || c.notes_hand_url || c.notes_typed_url || c.pdf_url) st.notes++;
  }
  for (const a of amendments ?? []) {
    const st = stats.get(a.subject_id as string);
    if (!st) continue;
    st.amendments++;
    const att = (a.valid_from_attempt as string) || "";
    if (att && !st.attempts.includes(att)) st.attempts.push(att);
  }
  const taught = await studentsTaught();
  let totalClasses = 0, totalMinutes = 0;
  for (const st of stats.values()) { totalClasses += st.classes; totalMinutes += st.minutes; }

  const FEATURES = [
    { i: "🗓️", t: "Day-by-day study plan", d: "A personal plan to exam day — classes, revisions & tests — that auto-adjusts to your pace and downloads as a PDF." },
    { i: "🤖", t: "Ask doubts anywhere, 24×7", d: "Ask on WhatsApp, Telegram or email — answered instantly by AI from the actual class material, and escalated to CA Parveen Sharma when needed." },
    { i: "🧠", t: "MCQ + descriptive tests", d: "Chapter tests with a performance report: your rank, weak concepts and exactly which classes to redo." },
    { i: "🔁", t: "3 structured revision rounds", d: "Revision videos + the most-important-questions list, sped up round by round, right up to the exam." },
    { i: "📜", t: "Amendments to your exam", d: "Every amendment kept updated and tagged to the exact attempt it applies to — never study an outdated topic." },
    { i: "📝", t: "Notes, PDFs, RTP & MTP", d: "Typed + handwritten notes, ICAI RTP/MTP and past papers, organised topic by topic." },
    { i: "📈", t: "Progress tracking", d: "We track your pace, gaps and regularity so you always know if you're on track — or what to catch up." },
    { i: "📦", t: "Books, PDFs & offline classes", d: "Printed hardcopy books delivered to you, downloadable PDF notes, streaming on any browser, and offline class downloads in our desktop app (Windows & Mac) — mobile apps coming soon." },
  ];

  // Course rich-result schema: one Course per subject, provider = the org
  // defined in the root layout's knowledge graph.
  const courseJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: (subjects ?? []).map((s: any, i: number) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Course",
        name: `${s.title} — ${courseTitle.get(s.course_id as string) ?? "CA"}`,
        description: `Complete ${s.title} preparation with CA Parveen Sharma — recorded classes, day-by-day study plan, tests with reports, revisions and amendments.`,
        provider: { "@id": "https://caparveensharma.com/#org" },
        url: "https://caparveensharma.com/courses",
        offers: { "@type": "Offer", category: "Paid", availability: "https://schema.org/InStock" },
        hasCourseInstance: { "@type": "CourseInstance", courseMode: "Online" },
      },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(courseJsonLd) }} />
      <section className="section">
        <div style={{ background: GRAD, color: "#fff", borderRadius: 22, padding: "40px 28px", textAlign: "center", marginBottom: 22 }}>
          <span style={{ display: "inline-block", background: "rgba(255,255,255,.18)", padding: "4px 12px", borderRadius: 999, fontSize: ".8rem", fontWeight: 700 }}>📚 Courses</span>
          <h1 style={{ color: "#fff", fontSize: "2rem", margin: "14px 0 8px" }}>Pass with a plan, not just classes</h1>
          <p style={{ maxWidth: 640, margin: "0 auto 20px", fontSize: "1.02rem", color: "rgba(255,255,255,.95)" }}>
            Advanced Accounting &amp; Financial Reporting by <strong>CA Parveen Sharma</strong> — concept classes, a
            day-by-day study plan, AI doubts on WhatsApp/Telegram, tests with reports, revisions &amp; amendments to your exam.
          </p>
          <div style={{ display: "flex", gap: 28, justifyContent: "center", flexWrap: "wrap" }}>
            <div><div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1 }}><CountUp value={(subjects ?? []).length} /></div><div style={{ fontSize: ".8rem", opacity: .92 }}>subjects</div></div>
            <div><div style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1 }}><CountUp value={taught} suffix="+" /></div><div style={{ fontSize: ".8rem", opacity: .92 }}>students taught</div></div>
          </div>
        </div>

        <div className="card" style={{ maxWidth: 860, margin: "0 auto 26px", border: "2px solid var(--accent)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14, textAlign: "center" }}>
            <div><div style={{ fontSize: "1.6rem" }}>📦</div><strong>Hardcopy books included</strong><div className="muted" style={{ fontSize: ".82rem" }}>Printed books delivered to your door, along with the classes.</div></div>
            <div><div style={{ fontSize: "1.6rem" }}>📥</div><strong>Download the PDFs</strong><div className="muted" style={{ fontSize: ".82rem" }}>Notes &amp; materials available to download and keep.</div></div>
            <div><div style={{ fontSize: "1.6rem" }}>📱</div><strong>Stream anywhere, download offline</strong><div className="muted" style={{ fontSize: ".82rem" }}>Watch in any browser; download &amp; watch offline in our desktop app (Windows &amp; Mac). iOS &amp; Android apps coming soon.</div></div>
          </div>
        </div>

        {(subjects ?? []).length > 0 ? (
          <div className="grid grid-3">
            {(subjects ?? []).map((s) => {
              const st = stats.get(s.id as string)!;
              const pics = photosByLevel.get(st.course) ?? [];
              const nPapers = papersBySubject.get(s.id as string) ?? 0;
              const nCases = casesBySubject.get(s.id as string) ?? 0;
              const sfrom = (s as any).valid_from_attempt as string | null;
              const sto = (s as any).valid_to_attempt as string | null;
              const applicable = sfrom ? (sto ? `${sfrom} up to ${sto}` : `from ${sfrom}`) : levelDefault(st.course.toLowerCase());
              const chips: { label: string; value: string }[] = [
                { label: "Classes", value: String(st.classes) },
                { label: "Class hours (at 1.25×)", value: hrs(st.minutes) },
                { label: "Topics", value: String(st.topics) },
                { label: "Tests", value: String(st.tests) },
                { label: "Revision videos", value: String(st.revisions) },
                ...(nPapers > 0 ? [{ label: "Practice papers (MTP/RTP/past)", value: String(nPapers) }] : []),
                ...(nCases > 0 ? [{ label: "Case scenarios", value: String(nCases) }] : []),
                { label: "Notes & PDFs", value: String(st.notes) },
              ];
              return (
                <div className="tile" key={s.id} style={{ textAlign: "left" }}>
                  {pics.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center" }}>
                        {pics.map((p, idx) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={idx} src={p.photo_url} alt={p.student_name} title={p.headline ? `${p.student_name} — ${p.headline}` : p.student_name}
                            style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--bg,#fff)", marginLeft: idx === 0 ? 0 : -10, boxShadow: "0 0 0 1px var(--border)" }} />
                        ))}
                      </div>
                      <div className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>🏆 Our {st.course} rank-holders &amp; toppers</div>
                    </div>
                  )}
                  <div className="ic">📘</div>
                  <h3 style={{ marginBottom: 2 }}>{s.title}</h3>
                  <p className="muted" style={{ fontSize: ".84rem", margin: 0 }}>
                    {st.course}{st.faculty.length ? ` · 👨‍🏫 ${st.faculty.join(", ")}` : ""}
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, margin: "14px 0" }}>
                    {chips.map((c) => (
                      <div key={c.label} style={{ background: "var(--bg-soft,#f6f7f9)", borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
                        <div style={{ fontSize: "1.15rem", fontWeight: 800 }}>{c.value}</div>
                        <div className="muted" style={{ fontSize: ".72rem" }}>{c.label}</div>
                      </div>
                    ))}
                  </div>
                  {applicable && (
                    <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 4px" }}>📅 Applicable {applicable}</p>
                  )}
                  <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 4px" }}>
                    📜 {st.amendments} amendment{st.amendments === 1 ? "" : "s"} — kept updated{st.attempts.length ? ` (applicable for ${st.attempts.slice(0, 3).join(", ")})` : " to your exam"}.
                  </p>
                  <p className="muted" style={{ fontSize: ".82rem", marginTop: 0 }}>
                    Includes the study planner, AI doubts, tests &amp; performance reports.
                  </p>
                  <p style={{ marginTop: 12 }}>
                    <Link className="btn small" href="/login">Start this subject →</Link>
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted" style={{ textAlign: "center" }}>📭 Courses are being published — please check back soon.</p>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">✨ What's built in</span>
          <h2>Everything in your package</h2>
          <p>Not just video classes — a complete system that guides you from your first class to the exam hall.</p>
        </div>
        <div className="grid grid-3">
          {FEATURES.map((f) => (
            <div className="tile" key={f.t} style={{ textAlign: "left" }}>
              <div className="ic">{f.i}</div>
              <h3 style={{ fontSize: "1.05rem" }}>{f.t}</h3>
              <p className="muted" style={{ fontSize: ".88rem" }}>{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {(results ?? []).length > 0 && (
        <section className="section">
          <div className="section-head">
            <span className="eyebrow">🏆 Results</span>
            <h2>Our students&apos; results</h2>
          </div>
          <div className="grid grid-3">
            {(results ?? []).map((r, i) => (
              <div className="tile" key={i} style={{ textAlign: "left" }}>
                <h3 style={{ fontSize: "1.05rem", marginBottom: 2 }}>{r.student_name}</h3>
                <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>{[r.headline, r.attempt, r.marks].filter(Boolean).join(" · ")}</p>
                {r.quote && <p style={{ fontSize: ".9rem", marginTop: 8, fontStyle: "italic" }}>&ldquo;{r.quote}&rdquo;</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section" style={{ textAlign: "center" }}>
        <h2>Ready to start?</h2>
        <p className="muted" style={{ maxWidth: 560, margin: "8px auto 16px" }}>
          Create your account, pick your subject, and your day-by-day plan + doubt-solving are ready instantly.
        </p>
        <Link className="btn" href="/login">Get started →</Link>
      </section>
    </>
  );
}
