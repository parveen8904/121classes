import Link from "next/link";
import { notFound } from "next/navigation";
import { tryServiceClient } from "@/lib/supabase/service";
import { summarizeSchedule } from "@/lib/schedule";

// PUBLIC subject explorer — a visitor (not logged in) can walk through
// everything a subject contains: chapter-by-chapter classes & hours, tests,
// resources, faculty, the intro video and live-batch schedule. Only when they
// want the actual content do we ask them to log in.
export const revalidate = 300;

const hrs = (mins: number) => {
  const m = Math.round((mins || 0) / 1.25);
  const h = Math.round(m / 60);
  return h > 0 ? `${h} hr${h === 1 ? "" : "s"}` : `${m} min`;
};

export async function generateMetadata(props: { params: Promise<{ subjectId: string }> }) {
  const params = await props.params;
  const svc = tryServiceClient();
  if (!svc) return {};
  const { data: s } = await svc.from("subjects").select("title, courses(title)").eq("id", params.subjectId).maybeSingle();
  if (!s) return {};
  const course = (s as { courses?: { title?: string } | null }).courses?.title ?? "CA";
  return {
    title: `${s.title} — ${course} | CA Parveen Sharma`,
    description: `Explore ${s.title} (${course}) — every chapter, class hours, tests, revisions and resources. First classes free after signup.`,
  };
}

export default async function PublicSubjectPage(props: { params: Promise<{ subjectId: string }> }) {
  const params = await props.params;
  const svc = tryServiceClient();
  if (!svc) return null;

  const { data: subject } = await svc
    .from("subjects")
    .select("id, title, course_id, valid_from_attempt, valid_to_attempt, intro_video_url, batch_months, batch_price_inr, included_with_subject_id, courses(title, is_published), subject_faculty(faculties(full_name))")
    .eq("id", params.subjectId)
    .maybeSingle();
  if (!subject || !(subject as { courses?: { is_published?: boolean } | null }).courses?.is_published) notFound();
  const courseTitle = (subject as { courses?: { title?: string } | null }).courses?.title ?? "";
  const faculty = ((subject as { subject_faculty?: { faculties?: { full_name?: string } | null }[] }).subject_faculty ?? [])
    .map((sf) => sf.faculties?.full_name).filter(Boolean).join(", ");

  const { data: topics } = await svc
    .from("topics")
    .select("id, title, order_index")
    .eq("subject_id", subject.id)
    .eq("is_published", true)
    .eq("is_combined", false)
    .order("order_index");
  const topicIds = (topics ?? []).map((t) => t.id as string);

  const { data: secs } = topicIds.length
    ? await svc.from("section_stats").select("section_id, topic_id, type, duration_minutes, class_no, has_notes").eq("is_published", true).in("topic_id", topicIds)
    : { data: [] as { section_id: string; topic_id: string; type: string; duration_minutes: string | null; class_no: string | null; has_notes: boolean | null }[] };

  // Item titles for the shop-window display (small columns only — NEVER config).
  const secIds = (secs ?? []).map((r) => r.section_id as string);
  const { data: secTitles } = secIds.length
    ? await svc.from("sections").select("id, title, order_index").in("id", secIds)
    : { data: [] as { id: string; title: string; order_index: number | null }[] };
  const titleBySec = new Map((secTitles ?? []).map((r) => [r.id as string, { title: r.title as string, order: Number(r.order_index) || 0 }]));

  // Per-topic classes + minutes; subject-wide totals for the chips; and the
  // full item list per chapter — the "shop window" a visitor can browse.
  type Item = { id: string; type: string; title: string; classNo: string; mins: number; order: number };
  const tClasses = new Map<string, number>(), tMins = new Map<string, number>();
  const tItems = new Map<string, Item[]>();
  let classes = 0, minutes = 0, revisions = 0, tests = 0, notes = 0;
  for (const r of secs ?? []) {
    const tid = r.topic_id as string;
    const d = Number(r.duration_minutes) || 0;
    const meta = titleBySec.get(r.section_id as string);
    const arr = tItems.get(tid) ?? [];
    arr.push({ id: r.section_id as string, type: r.type as string, title: meta?.title ?? "", classNo: String(r.class_no ?? ""), mins: d, order: meta?.order ?? 0 });
    tItems.set(tid, arr);
    if (r.type === "full_class_video") {
      tMins.set(tid, (tMins.get(tid) ?? 0) + d);
      minutes += d;
      if (!/[A-Za-z]/.test(String(r.class_no ?? ""))) { tClasses.set(tid, (tClasses.get(tid) ?? 0) + 1); classes++; }
    } else if (r.type === "revision_video") revisions++;
    else if (r.type === "mcq_test" || r.type === "subjective_test") tests++;
    if (r.type === "pdf" || r.has_notes) notes++;
  }
  for (const arr of tItems.values()) arr.sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title));
  const ITEM_ICON: Record<string, string> = {
    full_class_video: "🎬", revision_video: "🔁", mcq_test: "🧠", subjective_test: "✍️",
    pdf: "📝", live_class: "📡", case_set: "🧩",
  };
  const ITEM_LABEL: Record<string, string> = {
    full_class_video: "Class", revision_video: "Revision video", mcq_test: "MCQ test",
    subjective_test: "Descriptive test", pdf: "Notes / PDF", live_class: "Live class",
  };

  // Chapter class ranges in display order (Classes 1–22, 23–25, …).
  const range = new Map<string, { start: number; end: number }>();
  let run = 0;
  for (const t of topics ?? []) {
    const n = tClasses.get(t.id as string) ?? 0;
    if (n > 0) { range.set(t.id as string, { start: run + 1, end: run + n }); run += n; }
  }

  // Student-visible subject content BY NAME — the visitor sees exactly what
  // they'd get; downloading needs a (free) login. AI-only items stay hidden.
  const { data: repoRows } = await svc
    .from("repository_items")
    .select("kind, title, subject_id, topic_id")
    .eq("is_active", true)
    .eq("student_visible", true)
    .or(`subject_id.eq.${subject.id},topic_id.in.(${topicIds.join(",") || "00000000-0000-0000-0000-000000000000"})`);
  const kinds = new Map<string, number>();
  const materialsByKind = new Map<string, string[]>();
  for (const r of repoRows ?? []) {
    if (r.kind === "transcript") continue;
    // Do NOT advertise ICAI-branded copyright material by name on the PUBLIC
    // course page. A logged-in student still sees it inside their topic (that
    // page is a different query); it just isn't listed to a visitor who has not
    // signed in. (Team request, 22 Aug.)
    if (/icai/i.test(String(r.title ?? ""))) continue;
    kinds.set(r.kind as string, (kinds.get(r.kind as string) ?? 0) + 1);
    const arr = materialsByKind.get(r.kind as string) ?? [];
    arr.push((r.title as string) || (r.kind as string).toUpperCase());
    materialsByKind.set(r.kind as string, arr);
  }
  // Same category tiles (order + icon + label) the student dashboard shows.
  const RES_ORDER: { kind: string; icon: string; label: string }[] = [
    { kind: "notes", icon: "✍️", label: "Handwritten notes / book" },
    { kind: "book", icon: "📕", label: "Books" },
    { kind: "question_bank", icon: "📚", label: "Question bank" },
    { kind: "past_papers", icon: "🗂️", label: "Past exam papers" },
    { kind: "rtp", icon: "📝", label: "RTPs — Revision Test Papers" },
    { kind: "mtp", icon: "📝", label: "MTPs — Mock Test Papers" },
    { kind: "custom", icon: "✨", label: "Additional resources" },
  ];

  // Live batch: show the derived schedule right here.
  const isBatch = (Number((subject as { batch_months?: number | null }).batch_months) || 0) > 0;
  let sched: ReturnType<typeof summarizeSchedule> = null;
  if (isBatch) {
    const { data: rows } = await svc.from("class_schedule").select("scheduled_at").eq("subject_id", subject.id);
    sched = summarizeSchedule((rows ?? []) as { scheduled_at: string }[]);
  }

  const ytEmbed = (url: string) => {
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/);
    return m ? `https://www.youtube.com/embed/${m[1]}` : url;
  };
  const intro = ((subject as { intro_video_url?: string | null }).intro_video_url || "").trim();

  const loginNext = encodeURIComponent(`/learn/${subject.course_id}?subject=${subject.id}`);
  const plansNext = encodeURIComponent(`/learn/${subject.course_id}/plans?subject=${subject.id}`);

  const chips = [
    { label: "Classes", value: String(classes) },
    { label: "Class hours (at 1.25×)", value: hrs(minutes) },
    { label: "Chapters", value: String((topics ?? []).filter((t) => (tClasses.get(t.id as string) ?? 0) > 0).length) },
    { label: "Tests", value: String(tests) },
    { label: "Revision videos", value: String(revisions) },
    { label: "Notes & PDFs", value: String(notes) },
  ];

  // Structured data: THIS page is the canonical home of the course, so it
  // carries the full Course markup (the /courses listing has only the
  // summary ItemList). Provider and instructor point at the site-wide
  // @graph ids from the root layout, tying the course to the org + founder
  // entity Google already knows. Breadcrumbs give the result its trail.
  const pageUrl = `https://caparveensharma.com/courses/${subject.id}`;
  const courseLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Course",
        "@id": `${pageUrl}#course`,
        name: `${subject.title} — ${courseTitle}`,
        description: `${subject.title} (${courseTitle}) taught by CA Parveen Sharma: ${classes} recorded classes, chapter tests with AI reports, revision videos, notes and case-scenario practice.`,
        url: pageUrl,
        provider: { "@id": "https://caparveensharma.com/#org" },
        instructor: { "@id": "https://caparveensharma.com/#person" },
        inLanguage: "en",
        offers: { "@type": "Offer", category: "Paid", availability: "https://schema.org/InStock", url: pageUrl },
        hasCourseInstance: {
          "@type": "CourseInstance",
          courseMode: isBatch ? "Blended" : "Online",
          courseWorkload: minutes > 0 ? `PT${Math.round(minutes / 60)}H` : undefined,
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Courses", item: "https://caparveensharma.com/courses" },
          { "@type": "ListItem", position: 2, name: courseTitle, item: "https://caparveensharma.com/courses" },
          { "@type": "ListItem", position: 3, name: subject.title, item: pageUrl },
        ],
      },
    ],
  };

  return (
    <section className="section" style={{ maxWidth: 980, margin: "0 auto" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(courseLd) }} />
      <p className="crumb"><Link href="/courses">← All courses</Link></p>

      <div style={{ marginBottom: 14 }}>
        <span className="badge">{courseTitle}</span>
        {isBatch && <span style={{ background: "#dc2626", color: "#fff", borderRadius: 8, padding: "2px 10px", fontSize: ".82rem", marginLeft: 8, verticalAlign: "middle" }}>🔴 LIVE batch</span>}
        <h1 style={{ margin: "10px 0 4px" }}>{subject.title}</h1>
        {faculty && <p className="muted" style={{ margin: 0 }}>👨‍🏫 with {faculty}</p>}
        {isBatch && sched && (
          <p style={{ margin: "8px 0 0", fontSize: ".95rem" }}>
            🗓️ LIVE <strong>{sched.daysLabel}</strong> at <strong>{sched.timeLabel} IST</strong> · {sched.from} → {sched.to} · {sched.sessions} sessions · recordings included
          </p>
        )}
      </div>

      {/* Intro video — understand the subject before you start. */}
      {intro && (
        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <strong style={{ fontSize: ".95rem" }}>🎬 Watch this first — understand {subject.title}</strong>
          <div style={{ position: "relative", paddingTop: "56.25%", marginTop: 10, borderRadius: 10, overflow: "hidden" }}>
            <iframe src={ytEmbed(intro)} title={`${subject.title} — introduction`} loading="lazy" allowFullScreen
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
          </div>
        </div>
      )}

      {/* What's inside */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 8 }}>
        {chips.map((c) => (
          <div key={c.label} style={{ background: "var(--bg-soft,#f6f7f9)", borderRadius: 10, padding: "12px 8px", textAlign: "center" }}>
            <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{c.value}</div>
            <div className="muted" style={{ fontSize: ".74rem" }}>{c.label}</div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 16px" }}>
        🔁 <strong>Revision videos have NO watch-time limit</strong> — watch them as many times as you like till your
        validity ends. Regular classes come with 2× their duration as watch time.
      </p>

      {/* 📚 Subject resources — SAME tile layout the student dashboard uses,
          shown at the TOP of the shop window. Tap a category to see every file
          by name; downloading needs a (free) login. */}
      {kinds.size > 0 && (
        <div style={{ margin: "0 0 18px" }}>
          <h2 style={{ fontSize: "1.2rem", margin: "0 0 2px" }}>📚 Subject resources — everything included</h2>
          <p className="muted" style={{ fontSize: ".8rem", margin: "2px 0 8px" }}>
            Our own handwritten notes &amp; question banks are FREE for every student as PDFs — 9+ month Gold
            subscribers also get them as FREE printed hard copies couriered home (within India).
            Tap a category to see every file; downloading needs a free account.
          </p>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {RES_ORDER.map((cat) => {
              const titles = materialsByKind.get(cat.kind) ?? [];
              if (titles.length === 0) return null;
              return (
                <details key={cat.kind} className="res-tile" style={{ border: "2px solid var(--accent)", borderRadius: 12, background: "var(--bg-soft)", overflow: "hidden" }}>
                  <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", fontWeight: 700 }}>
                    <span style={{ fontSize: "1.4rem", lineHeight: 1 }}>{cat.icon}</span>
                    <span style={{ flex: 1, fontSize: ".9rem" }}>{cat.label}</span>
                    <span style={{ background: "var(--accent)", color: "#fff", borderRadius: 999, padding: "1px 10px", fontSize: ".8rem" }}>{titles.length}</span>
                  </summary>
                  <div style={{ display: "grid", gap: 6, padding: "0 12px 12px" }}>
                    {titles.map((t, i) => (
                      <a
                        key={i}
                        href={`/login?next=${loginNext}`}
                        style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", background: "var(--card)", borderRadius: 8, padding: "8px 12px", color: "var(--text)" }}
                      >
                        <span style={{ fontSize: ".88rem" }}><strong>{t}</strong></span>
                        <span style={{ color: "var(--accent)", fontWeight: 700, whiteSpace: "nowrap", fontSize: ".82rem" }}>🔒 Login →</span>
                      </a>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}

      {/* Free demo pitch */}
      <div className="card" style={{ border: "2px solid var(--accent)", marginBottom: 16 }}>
        <strong>🎁 Try it free</strong>
        <p className="muted" style={{ margin: "4px 0 10px", fontSize: ".9rem" }}>
          The first classes of the subject are <strong>free demo classes</strong> — create a free account and start
          watching in one minute. No payment needed to explore.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn" href={`/login?next=${loginNext}`}>▶️ Watch free demo classes →</a>
          <a className="btn secondary" href={`/login?next=${plansNext}`}>See plans &amp; enroll →</a>
        </div>
      </div>

      {/* Chapter by chapter — the full shop window. Every class, note, test and
          revision is displayed BY NAME; opening any of them asks for login. */}
      {(topics ?? []).length > 0 && (
        <>
          <h2 style={{ fontSize: "1.2rem", margin: "20px 0 4px" }}>📚 Chapter by chapter — see everything inside</h2>
          <p className="muted" style={{ fontSize: ".84rem", margin: "0 0 8px" }}>
            Tap a chapter to see every class, note and test it contains. Opening any item needs a free account.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {(topics ?? []).map((t) => {
              const r = range.get(t.id as string);
              const m = tMins.get(t.id as string) ?? 0;
              const items = tItems.get(t.id as string) ?? [];
              return (
                <details key={t.id as string} className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px" }}>
                    <span style={{ fontWeight: 700 }}>{t.title}</span>
                    <span className="muted" style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: ".85rem" }}>
                      {r ? (r.start === r.end ? `Class ${r.start}` : `Classes ${r.start}–${r.end}`) : "—"}
                      {m > 0 && <> · ⏱️ {hrs(m)}</>}
                      {" "}▾
                    </span>
                  </summary>
                  {items.length > 0 ? (
                    <div style={{ borderTop: "1px solid var(--border)", padding: "6px 16px 12px" }}>
                      {items.map((it) => (
                        <a
                          key={it.id}
                          href={`/login?next=${encodeURIComponent(`/learn/topic/${t.id}`)}`}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: "1px dashed var(--border)", color: "var(--text)", fontSize: ".88rem" }}
                        >
                          <span>
                            {ITEM_ICON[it.type] ?? "📄"}{" "}
                            {it.type === "full_class_video" && it.classNo ? <strong>Class {it.classNo} — </strong> : null}
                            {it.title || ITEM_LABEL[it.type] || "Item"}
                            {it.type !== "full_class_video" && ITEM_LABEL[it.type] ? <span className="muted"> · {ITEM_LABEL[it.type]}</span> : null}
                          </span>
                          <span className="muted" style={{ whiteSpace: "nowrap", fontSize: ".8rem" }}>
                            {it.mins > 0 ? `⏱️ ${it.mins}m · ` : ""}🔒 Login to open
                          </span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="muted" style={{ padding: "0 16px 12px", margin: 0, fontSize: ".85rem" }}>Content being uploaded.</p>
                  )}
                </details>
              );
            })}
          </div>
        </>
      )}

      {/* The polite wall — only now. */}
      <div className="card" style={{ textAlign: "center", margin: "26px auto 0", maxWidth: 560 }}>
        <div style={{ fontSize: "1.6rem" }}>🔐</div>
        <h3 style={{ margin: "6px 0" }}>Really interested? Log in for more</h3>
        <p className="muted" style={{ fontSize: ".88rem" }}>
          Watch the free demo classes, build your day-by-day study plan and ask your first doubts — all free
          after a one-minute signup.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <a className="btn" href={`/login?next=${loginNext}`}>Create free account / Log in →</a>
        </div>
      </div>
    </section>
  );
}
