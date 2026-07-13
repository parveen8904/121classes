import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { videoEmbedSrc } from "../../_lib/media";
import { attemptRank, effectiveAttemptWindow } from "../../_lib/attempt";
import { bunnyEmbedUrl } from "@/lib/bunny";
import DoubtBox from "./DoubtBox";
import ClassDownload from "./ClassDownload";
import SectionCard from "./SectionCard";
import DiscussionBoard from "../../section/[sectionId]/DiscussionBoard";
import Help from "@/app/components/Help";
import { fmtMins } from "@/lib/duration";

type Downloadable = {
  id: string;
  section_id: string | null;
  storage_url: string;
  iv_b64: string | null;
  alg: string | null;
  byte_size: number | null;
};

export const dynamic = "force-dynamic";

// Minutes -> "1h 30m" / "45m".

type SectionMeta = {
  id: string;
  type: string;
  title: string;
  order_index: number;
  min_plan: string | null;
  unlocked: boolean;
};

// Every video kind gets YouTube-style comments — free (bronze) classes included,
// not just premium full classes.
const VIDEO_TYPES = new Set(["full_class_video", "revision_video", "discussion_video", "custom"]);

const PLAN_LABEL: Record<string, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold" };
const TYPE_LABEL: Record<string, string> = {
  revision_video: "Revision video",
  full_class_video: "Class",
  discussion_video: "Discussion video",
  discussion: "Discussion board",
  homework: "Homework",
  pdf: "PDF",
  rich_text: "Notes",
  past_papers: "Past papers",
  live_class: "Live class",
  ask_doubt: "Ask a doubt",
  mcq_test: "MCQ test",
  subjective_test: "Subjective test",
  custom: "Section",
};
const TYPE_ICON: Record<string, string> = {
  revision_video: "🎬",
  full_class_video: "🎓",
  discussion_video: "🎞️",
  discussion: "🗣️",
  homework: "📚",
  pdf: "📑",
  rich_text: "📝",
  past_papers: "🗂️",
  live_class: "📡",
  ask_doubt: "💬",
  mcq_test: "🧠",
  subjective_test: "✍️",
  custom: "📦",
};

// Sections are shown grouped under small banners so classes, revision videos,
// tests etc. don't blur together. Revision videos split into First / Second
// rounds; a group only appears when it has content. Order = display order.
const SECTION_GROUP_ORDER = [
  "🎓 Classes",
  "🎬 Revision — first",
  "🎬 Revision — second",
  "🎞️ Discussion & live videos",
  "📚 Homework",
  "📑 Notes & PDFs",
  "🧠 MCQ tests",
  "✍️ Descriptive tests",
  "🗣️ Discussion & doubts",
  "📦 More",
];

function SectionBody({
  id,
  type,
  config,
  watermark,
  hasDownload,
}: {
  id: string;
  type: string;
  config: Record<string, unknown> | null;
  watermark?: string;
  hasDownload?: boolean;
}) {
  const c = (config ?? {}) as Record<string, string>;

  if (type === "discussion") {
    return (
      <div style={{ marginTop: 14 }}>
        {c.body && <p style={{ marginBottom: 12, whiteSpace: "pre-wrap" }}>{c.body}</p>}
        <Link className="btn small" href={`/learn/section/${id}`}>
          Open discussion board →
        </Link>
      </div>
    );
  }

  if (
    type === "revision_video" ||
    type === "full_class_video" ||
    type === "discussion_video" ||
    type === "custom"
  ) {
    const src = c.bunny_video_id ? bunnyEmbedUrl(c.bunny_video_id, c.bunny_drm !== "off") : videoEmbedSrc(config);
    const isRev = type === "revision_video";
    const durLabel = fmtMins(Number(c.duration_minutes));
    const hasDetail = c.class_number || c.class_no || c.topic_class_no || durLabel;
    return (
      <>
        {hasDetail && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            {c.class_number && (
              <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: ".92rem", background: "var(--bg-soft)", border: "1px solid var(--border)", padding: "3px 10px", borderRadius: 6, letterSpacing: ".5px" }}>
                {c.class_number}
              </span>
            )}
            {!isRev && c.topic_class_no && <span style={{ fontWeight: 600, fontSize: ".85rem" }}>Topic class no {c.topic_class_no}</span>}
            {c.class_no && <span style={{ fontWeight: 600, fontSize: ".85rem" }}>{isRev ? "Revision no" : "Class no"} {c.class_no}</span>}
            {durLabel && <span style={{ fontWeight: 600, fontSize: ".85rem" }}>⏱️ {durLabel}</span>}
          </div>
        )}
        {src ? (
          <div className="video-frame" style={{ marginTop: 14 }}>
            <iframe src={src} allow="encrypted-media; fullscreen" allowFullScreen title="Video" />
            {watermark && <span className="vwm">{watermark}</span>}
          </div>
        ) : hasDownload ? (
          <p className="muted" style={{ marginTop: 12 }}>
            📥 This class is available to download and watch securely in the desktop app.
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 12 }}>
            Video coming soon.
          </p>
        )}
        {c.body && <p style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{c.body}</p>}
        {(c.pdf_url || c.notes_hand_url || c.notes_typed_url || c.homework_solutions) && (
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            {/* All notes open in the in-app viewer: our URL only + moving student watermark. */}
            {c.pdf_url && <Link className="btn small secondary" href={`/learn/notes/${id}?kind=pdf`}>📄 Class notes (PDF)</Link>}
            {c.notes_hand_url && <Link className="btn small secondary" href={`/learn/notes/${id}?kind=hand`}>✍️ Handwritten notes</Link>}
            {c.notes_typed_url && <Link className="btn small secondary" href={`/learn/notes/${id}?kind=typed`}>⌨️ Typed notes</Link>}
            {c.homework_solutions && <Link className="btn small secondary" href={`/learn/notes/${id}?kind=homework`}>✅ Homework solutions</Link>}
          </div>
        )}
        {c.homework && (
          <div style={{ marginTop: 12 }}>
            <strong style={{ fontSize: ".9rem" }}>📚 Homework</strong>
            <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{c.homework}</p>
          </div>
        )}
        {c.ai_homework_next && (
          <div style={{ marginTop: 12, background: "var(--bg-soft)", borderLeft: "3px solid var(--accent)", padding: "10px 12px", borderRadius: 8 }}>
            <strong style={{ fontSize: ".9rem" }}>📚 Homework for the next class</strong>
            <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{c.ai_homework_next}</p>
          </div>
        )}
        {c.ai_summary && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", color: "var(--accent)" }}>📋 Class summary</summary>
            <div style={{ marginTop: 8, fontSize: ".9rem" }}>
              <p style={{ marginTop: 0 }}>{c.ai_summary}</p>
              {c.ai_concepts_discussed && (
                <p style={{ margin: "6px 0" }}><strong>🔑 Concepts covered:</strong> {String(c.ai_concepts_discussed).split("\n").filter(Boolean).join(" · ")}</p>
              )}
              {c.ai_questions_discussed && (
                <p style={{ margin: "6px 0" }}><strong>❓ Questions discussed:</strong> {String(c.ai_questions_discussed).split("\n").filter(Boolean).join(" · ")}</p>
              )}
              <p style={{ margin: "6px 0 0" }}>
                <strong>📝 {Number(c.ai_homework_count) || 0} homework questions</strong> solved in class
                {c.ai_homework_next ? <> · <strong>Homework for next class:</strong> {c.ai_homework_next}</> : null}
              </p>
            </div>
          </details>
        )}
        {c.notes_typed_status === "approved" && c.notes_typed_text && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", color: "var(--accent)" }}>⌨️ Typed notes (faculty-approved)</summary>
            <a className="btn small secondary" href={`/learn/pdf?u=${encodeURIComponent(`/learn/notes/${id}/pdf`)}&t=Typed notes`} style={{ marginTop: 8, display: "inline-block" }}>
              ⬇️ Download typed notes (PDF)
            </a>
            <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{c.notes_typed_text}</p>
          </details>
        )}
      </>
    );
  }

  if (type === "homework") {
    return (
      <div style={{ marginTop: 14 }}>
        {c.body && <p style={{ whiteSpace: "pre-wrap" }}>{c.body}</p>}
        {c.pdf_url && (
          <a
            className="btn small"
            href={`/learn/pdf?u=${encodeURIComponent(c.pdf_url as string)}&t=Homework`}
            style={{ marginTop: c.body ? 12 : 0 }}
          >
            📄 Homework PDF
          </a>
        )}
        {!c.body && !c.pdf_url && (
          <p className="muted">📝 Homework will be posted here soon.</p>
        )}
      </div>
    );
  }

  if (type === "pdf" || type === "past_papers") {
    return (
      <div style={{ marginTop: 14 }}>
        {c.pdf_url ? (
          <a className="btn small" href={`/learn/pdf?u=${encodeURIComponent(c.pdf_url as string)}&t=PDF`}>
            View / Download PDF
          </a>
        ) : (
          <p className="muted">PDF will be uploaded soon.</p>
        )}
        {c.body && <p style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{c.body}</p>}
      </div>
    );
  }

  if (type === "rich_text") {
    return c.body ? (
      <p style={{ marginTop: 14, whiteSpace: "pre-wrap" }}>{c.body}</p>
    ) : (
      <p className="muted" style={{ marginTop: 14 }}>
        Notes coming soon.
      </p>
    );
  }

  if (type === "live_class") {
    const when = c.starts_at ? new Date(c.starts_at) : null;
    const whenLabel =
      when && !isNaN(when.getTime())
        ? when.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
        : c.starts_at;
    return (
      <div style={{ marginTop: 14 }}>
        {whenLabel && <p className="muted">🗓️ {whenLabel}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          {c.join_url && (
            <>
              <a className="btn small" href={c.join_url} target="_blank" rel="noopener noreferrer">
                📡 Join live class
              </a>
              <Help text="Opens the live class link at the scheduled time. Join a few minutes early. A recording usually appears here afterwards." />
            </>
          )}
          {c.recording_url && (
            <a className="btn small secondary" href={c.recording_url} target="_blank" rel="noopener noreferrer">
              ▶️ Watch recording
            </a>
          )}
        </div>
        {!c.join_url && !c.recording_url && (
          <p className="muted">The join link appears here before the session.</p>
        )}
      </div>
    );
  }

  if (type === "ask_doubt") {
    return <DoubtBox sectionId={id} />;
  }

  if (type === "mcq_test" || type === "subjective_test") {
    return (
      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Link className="btn small" href={`/learn/section/${id}`}>
          {type === "mcq_test" ? "Start MCQ test 🧠" : "Start subjective test ✍️"} →
        </Link>
        {c.pdf_url && (
          <a className="btn small secondary" href={`/learn/pdf?u=${encodeURIComponent(c.pdf_url as string)}&t=Question paper`}>📄 Question paper (PDF)</a>
        )}
        <Help
          text={
            type === "mcq_test"
              ? "A multiple-choice test on this topic. Pick answers and submit to see your score instantly."
              : "Write/upload your answers. They're checked against the faculty's marking scheme, and you get a detailed performance report."
          }
        />
      </div>
    );
  }

  return null;
}

export default async function LearnTopic({ params }: { params: { topicId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/learn/topic/${params.topicId}`);

  const { data: topic } = await supabase
    .from("topics")
    .select("id, title, subject_id, topic_code, weightage_marks, importance, important_qs_rev1, important_qs_rev2, valid_from_attempt, valid_to_attempt, amendments_upto, application_notes, update_coming, update_on, update_for, update_note, subjects(title, course_id, valid_from_attempt, valid_to_attempt)")
    .eq("id", params.topicId)
    .single();
  if (!topic) notFound();

  // Who's viewing — admins & faculty preview ALL sections (incl. paid) with full content.
  const { data: wmProfile } = await supabase
    .from("profiles")
    .select("full_name, phone, role, target_attempt")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = wmProfile?.role === "admin" || wmProfile?.role === "faculty";
  const watermarkText = [wmProfile?.full_name, user.email ?? wmProfile?.phone].filter(Boolean).join(" · ");

  const configById = new Map<string, Record<string, unknown> | null>();
  const sectionGroupId = new Map<string, string | null>(); // section item → its Section (group)
  let sections: SectionMeta[] = [];

  if (isAdmin) {
    // Service client → every published section, fully unlocked, with its content.
    // sections_lite = sections minus the transcript text (megabytes we never show here).
    const { data: rows } = await createServiceClient()
      .from("sections_lite")
      .select("id, type, title, order_index, min_plan, config, group_id")
      .eq("topic_id", topic.id)
      .eq("is_published", true)
      .order("order_index")
      .order("title");
    for (const r of rows ?? []) {
      configById.set(r.id, r.config as Record<string, unknown> | null);
      sectionGroupId.set(r.id, (r as { group_id?: string | null }).group_id ?? null);
      sections.push({ id: r.id, type: r.type, title: r.title, order_index: r.order_index, min_plan: r.min_plan, unlocked: true });
    }
  } else {
    // Students: RPC marks paid sections locked; RLS gives config for unlocked ones.
    const [{ data: metas, error: metaErr }, { data: accessRows }] = await Promise.all([
      supabase.rpc("list_topic_sections", { p_topic: topic.id }),
      supabase
      .from("sections_lite")
      .select("id, type, title, order_index, min_plan, is_published, config, group_id")
      .eq("topic_id", topic.id)
      .eq("is_published", true)
      .order("order_index")
      .order("title"),
    ]);
    for (const r of accessRows ?? []) {
      configById.set(r.id, r.config as Record<string, unknown> | null);
      sectionGroupId.set(r.id, (r as { group_id?: string | null }).group_id ?? null);
    }
    sections =
      !metaErr && metas
        ? (metas as SectionMeta[])
        : (accessRows ?? []).map((r) => ({ id: r.id, type: r.type, title: r.title, order_index: r.order_index, min_plan: r.min_plan, unlocked: true }));
  }

  // Named Sections (content groups) the admin created for this topic.
  // One parallel round trip for all remaining independent lookups (was 5
  // sequential queries — the other big cause of slow topic-page clicks).
  const svcP = createServiceClient();
  const [{ data: topicGroups }, { data: dlRows }, { data: topicMaterials }, { data: amendRows }, { data: durRows }] = await Promise.all([
    svcP.from("topic_groups").select("id, name, order_index").eq("topic_id", topic.id).order("order_index").order("created_at"),
    supabase.rpc("list_downloadable_classes"),
    svcP.from("repository_items").select("id, title, kind, file_url").eq("topic_id", topic.id).eq("is_active", true).eq("student_visible", true).not("file_url", "is", null).order("created_at", { ascending: false }),
    svcP.from("amendments").select("id, title, body, discussion, bunny_video_id, bunny_drm, youtube_url, embed_url, notes_hand_url, valid_from_attempt, valid_to_attempt").eq("topic_id", topic.id).eq("is_published", true).order("order_index"),
    svcP.from("sections").select("id, type, duration_minutes:config->>duration_minutes, class_no:config->>class_no").eq("topic_id", topic.id).eq("is_published", true),
  ]);
  const groupList = topicGroups ?? [];

  // Encrypted classes the student may download, keyed by section (for the
  // "Download for offline" button on the class).
  const downloadBySection = new Map<string, Downloadable>();
  for (const d of (dlRows ?? []) as Downloadable[]) {
    if (d.section_id) downloadBySection.set(d.section_id, d);
  }

  const subject = (topic as { subjects?: { title?: string; course_id?: string } | null }).subjects;
  const courseId = subject?.course_id;

  // Topic materials (question bank / ICAI / RTP / past papers / book) — the SAME
  // PDFs that train the AI are offered to students here. One upload, both uses.
  const MAT_LABEL: Record<string, string> = { question_bank: "📚 Question bank", icai: "🏛️ ICAI material", rtp: "📄 RTP", past_papers: "🗂️ Past papers", book: "📕 Book", notes: "📝 Notes", revision_notes: "🔁 Revision notes", transcript: "🎙️ Transcript", other: "📄 Material" };

  // Amendments & updates for THIS topic, filtered to the student's attempt.
  const myAttemptRank = attemptRank(wmProfile?.target_attempt ?? null);
  const topicAmendments = (amendRows ?? []).filter((a) => {
    if (myAttemptRank === null) return true;
    const f = attemptRank(a.valid_from_attempt);
    const e = attemptRank(a.valid_to_attempt);
    if (f !== null && myAttemptRank < f) return false;
    if (e !== null && myAttemptRank > e) return false;
    return true;
  }).map((a) => ({
    ...a,
    videoSrc: a.bunny_video_id
      ? bunnyEmbedUrl(a.bunny_video_id, a.bunny_drm !== "off")
      : videoEmbedSrc({ youtube_url: a.youtube_url ?? undefined, embed_url: a.embed_url ?? undefined } as Record<string, unknown>),
  }));

  // Continuous class numbers across the whole subject (matching the course-page
  // ranges): topic 1 → Class 1..10, topic 2 → Class 11..15, etc. ≤100-min "part"
  // continuations (class_no like 7B) share the previous number with their suffix.
  const classNoLabel = new Map<string, string>();
  {
    const svc = createServiceClient();
    const { data: subjTopics } = await svc
      .from("topics")
      .select("id, order_index, title")
      .eq("subject_id", topic.subject_id)
      .order("order_index")
      .order("title");
    const orderedTopicIds = (subjTopics ?? []).map((t) => t.id);
    if (orderedTopicIds.length) {
      const { data: classRows } = await svc
        .from("sections")
        .select("id, topic_id, order_index, title, class_no:config->>class_no")
        .in("topic_id", orderedTopicIds)
        .eq("type", "full_class_video")
        .eq("is_published", true)
        .order("order_index")
        .order("title");
      const byTopic = new Map<string, { id: string; class_no: string | null }[]>();
      for (const r of classRows ?? []) {
        const arr = byTopic.get(r.topic_id as string) ?? [];
        arr.push({ id: r.id as string, class_no: (r as { class_no?: string | null }).class_no ?? null });
        byTopic.set(r.topic_id as string, arr);
      }
      let running = 0;
      for (const tid of orderedTopicIds) {
        for (const r of byTopic.get(tid) ?? []) {
          const suffix = String(r.class_no ?? "").replace(/[^A-Za-z]/g, "");
          if (suffix) {
            classNoLabel.set(r.id, `Class ${running}${suffix}`); // part continuation (e.g. 7B)
          } else {
            running += 1;
            classNoLabel.set(r.id, `Class ${running}`);
          }
        }
      }
    }
  }

  // Durations for EVERY published section in this topic — including locked ones —
  // so the duration on each class and the topic total are the true catalog figures
  // for all students (content stays locked; only the minutes are shown).
  const durById = new Map<string, number>();
  let topicTotalMins = 0;
  let topicMainClasses = 0;
  {
    for (const r of durRows ?? []) {
      const row = r as { id: string; type?: string; duration_minutes?: string | null; class_no?: string | null };
      const d = Number(row.duration_minutes) || 0;
      durById.set(row.id, d);
      if (row.type === "full_class_video") {
        topicTotalMins += d;
        if (!/[A-Za-z]/.test(String(row.class_no ?? ""))) topicMainClasses += 1;
      }
    }
  }

  // Hit-list importance for the student's own attempt.
  const importance = ((topic as { importance?: Record<string, string> | null }).importance) ?? {};
  const norm = (s: string) => s.toLowerCase().replace(/[_\s]+/g, " ").trim();
  const myAttempt = wmProfile?.target_attempt ?? "";
  let myCategory = "";
  for (const [att, cat] of Object.entries(importance)) {
    if (norm(att) === norm(myAttempt)) { myCategory = cat; break; }
  }
  const CAT_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
    A: { bg: "#fee2e2", fg: "#b91c1c", label: "Category A — most important (must do)" },
    B: { bg: "#fef3c7", fg: "#b45309", label: "Category B — important" },
    C: { bg: "#e5e7eb", fg: "#374151", label: "Category C — do if time permits" },
  };
  const catStyle = CAT_STYLE[myCategory];
  const plansHref = courseId
    ? `/learn/${courseId}/plans?subject=${topic.subject_id}`
    : "/dashboard";

  // Which banner group a section belongs to (revision videos split by round).
  const groupFor = (s: SectionMeta): string => {
    const c = (configById.get(s.id) ?? {}) as Record<string, string>;
    switch (s.type) {
      case "full_class_video":
        return "🎓 Classes";
      case "revision_video": {
        const r = String(c.revision_round ?? "").toLowerCase();
        return r.includes("2") || r.includes("sec") ? "🎬 Revision — second" : "🎬 Revision — first";
      }
      case "discussion_video":
      case "live_class":
        return "🎞️ Discussion & live videos";
      case "homework":
        return "📚 Homework";
      case "pdf":
      case "past_papers":
      case "rich_text":
        return "📑 Notes & PDFs";
      case "mcq_test":
        return "🧠 MCQ tests";
      case "subjective_test":
        return "✍️ Descriptive tests";
      case "discussion":
      case "ask_doubt":
      case "custom":
        return "🗣️ Discussion & doubts";
      default:
        return "📦 More";
    }
  };

  const renderSection = (s: SectionMeta) => {
    const locked = !s.unlocked;
    const planName = s.min_plan ? PLAN_LABEL[s.min_plan] ?? s.min_plan : "a paid";
    const c = (configById.get(s.id) ?? {}) as Record<string, string>;
    const durMin = durById.get(s.id) ?? Number(c.duration_minutes) ?? 0;
    const dur =
      s.type === "full_class_video" || s.type === "revision_video"
        ? fmtMins(durMin)
        : "";
    // Class / revision number on the right — slimmer italic, so the TITLE owns the bold.
    let rightLabel: string | undefined;
    if (s.type === "full_class_video") rightLabel = classNoLabel.get(s.id);
    else if (s.type === "revision_video" && c.class_no) rightLabel = `Revision ${c.class_no}`;
    const hasSummary = s.type === "full_class_video" && !!c.ai_summary && !locked;
    // Universal description + link, shown to students for any content.
    const descLink = (c.description || c.link_url) ? (
      <div style={{ marginTop: 8 }}>
        {c.description && <p className="muted" style={{ margin: 0, fontSize: ".85rem", whiteSpace: "pre-wrap" }}>{c.description}</p>}
        {c.link_url && <a href={c.link_url} target="_blank" rel="noopener noreferrer" className="btn small secondary" style={{ marginTop: 6, display: "inline-block" }}>🔗 Open link</a>}
      </div>
    ) : null;
    // Unlocked videos open on their OWN focused page (only that class is shown);
    // students come back to this topic for the other classes.
    if (!locked && VIDEO_TYPES.has(s.type)) {
      return (
        <Link
          key={s.id}
          href={`/learn/section/${s.id}`}
          className="sec-card"
          style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--text)" }}
        >
          <span className="sec-ic">{TYPE_ICON[s.type] ?? "📦"}</span>
          <div style={{ minWidth: 0 }}>
            <div className="sec-title">{s.title}</div>
            <div className="sec-type">{TYPE_LABEL[s.type] ?? s.type}{dur ? ` · ⏱️ ${dur}` : ""}</div>
            {c.description && <div className="muted" style={{ fontSize: ".8rem", marginTop: 2, whiteSpace: "pre-wrap" }}>{c.description}</div>}
          </div>
          <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
            {rightLabel && <span className="muted" style={{ fontSize: ".92rem", fontWeight: 400, fontStyle: "italic", whiteSpace: "nowrap" }}>{rightLabel}</span>}
            {hasSummary && (
              <span style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--accent)", border: "1px solid var(--accent)", borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>📋 Summary</span>
            )}
            <span aria-hidden style={{ opacity: 0.6, fontWeight: 700 }}>▸</span>
          </span>
        </Link>
      );
    }
    return (
      <SectionCard
        key={s.id}
        icon={TYPE_ICON[s.type] ?? "📦"}
        title={s.title}
        typeLabel={TYPE_LABEL[s.type] ?? s.type}
        meta={dur ? `⏱️ ${dur}` : ""}
        rightLabel={rightLabel}
        summaryChip={hasSummary}
        locked={locked}
        lockBadge={locked ? <span className="lock-badge">🔒 {s.min_plan ? PLAN_LABEL[s.min_plan] : "Locked"}</span> : null}
      >
        {locked ? (
          <div className="lock-row">
            <span className="txt">
              🔒 Locked. Unlock all <strong>{planName}</strong> content for{" "}
              <strong>{subject?.title ?? "this subject"}</strong>.
            </span>
            <Link className="btn small" href={plansHref}>
              Unlock →
            </Link>
          </div>
        ) : (
          <>
            <SectionBody
              id={s.id}
              type={s.type}
              config={configById.get(s.id) ?? null}
              watermark={watermarkText}
              hasDownload={downloadBySection.has(s.id)}
            />
            {descLink}
            {downloadBySection.has(s.id) && (
              <ClassDownload pv={downloadBySection.get(s.id)!} watermark={watermarkText} />
            )}
            {VIDEO_TYPES.has(s.type) && (
              <div style={{ marginTop: 18 }}>
                <h3 style={{ fontSize: "1rem", marginBottom: 10 }}>💬 Comments</h3>
                <DiscussionBoard
                  sectionId={s.id}
                  userId={user.id}
                  isAdmin={isAdmin}
                  returnPath={`/learn/topic/${topic.id}`}
                  promptLabel="Add a comment"
                  placeholder="Ask a question or share a thought…"
                />
              </div>
            )}
          </>
        )}
      </SectionCard>
    );
  };

  const sectionGroupBanner = (label: string, count: number, mins = 0) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "28px 0 12px" }}>
      <span style={{ fontWeight: 800, fontSize: "1.05rem" }}>{label}</span>
      <span className="muted" style={{ fontSize: ".8rem" }}>({count})</span>
      {mins > 0 && (
        <span className="muted" style={{ fontSize: ".8rem", whiteSpace: "nowrap" }}>
          ⏱️ {fmtMins(mins)}
        </span>
      )}
      <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );

  // Total minutes of the given items (durations synced from Bunny).
  const groupMins = (items: { id: string }[]) => items.reduce((sum, s) => sum + (durById.get(s.id) ?? 0), 0);

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
        <p className="crumb">
          {courseId ? (
            <Link href={`/learn/${courseId}`}>← {subject?.title ?? "Subject"}</Link>
          ) : (
            <Link href="/dashboard">← Dashboard</Link>
          )}
        </p>

        <div className="learn-hero">
          <span className="badge">📖 Topic{(topic as { topic_code?: string | null }).topic_code ? ` ${(topic as { topic_code?: string }).topic_code}` : ""}</span>
          <h1>{topic.title}</h1>
          <p className="meta">
            {topicMainClasses > 0 && <>🎓 {topicMainClasses} {topicMainClasses === 1 ? "class" : "classes"} · ⏱️ {fmtMins(topicTotalMins)} · </>}
            {sections.length} section{sections.length === 1 ? "" : "s"} · revision, notes, tests &amp;
            doubt-solving
            {(topic as { weightage_marks?: number | null }).weightage_marks
              ? ` · 🎯 ${(topic as { weightage_marks?: number }).weightage_marks} marks (ICAI weightage)`
              : ""}
          </p>
        </div>

        {catStyle && (
          <div style={{ marginTop: 16, background: catStyle.bg, color: catStyle.fg, padding: "10px 14px", borderRadius: 8, fontWeight: 700 }}>
            🎯 {catStyle.label}{myAttempt ? ` — for your ${String(myAttempt).replace(/_/g, " ")} attempt` : ""}
          </div>
        )}

        {(topic as { application_notes?: string | null }).application_notes && (
          <div style={{ marginTop: 16, background: "rgba(234,179,8,0.14)", border: "2px solid #eab308", padding: "12px 14px", borderRadius: 10 }}>
            <strong>📌 Application notes — please read carefully</strong>
            <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{(topic as { application_notes?: string }).application_notes}</p>
          </div>
        )}

        {(topic as { update_coming?: boolean }).update_coming && (
          <div
            className="notice"
            style={{ marginTop: 16, background: "var(--bg-soft)", borderLeft: "4px solid var(--accent)", padding: "12px 14px", borderRadius: 8 }}
          >
            <strong>🔔 Updated content coming{(topic as { update_on?: string | null }).update_on ? ` on ${new Date((topic as { update_on?: string }).update_on!).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}` : " soon"}.</strong>
            {(topic as { update_note?: string | null }).update_note && (
              <span> {(topic as { update_note?: string }).update_note}</span>
            )}
            {(topic as { update_for?: string | null }).update_for && (
              <span className="muted" style={{ display: "block", fontSize: ".85rem", marginTop: 4 }}>
                Applicable for: {(topic as { update_for?: string }).update_for}
              </span>
            )}
          </div>
        )}

        {(() => {
          const td = topic as {
            valid_from_attempt?: string | null;
            valid_to_attempt?: string | null;
            amendments_upto?: string | null;
            important_qs_rev1?: string | null;
            important_qs_rev2?: string | null;
            subjects?: { valid_from_attempt?: string | null; valid_to_attempt?: string | null } | null;
          };
          // Effective window: the topic's own override if set, else the subject's.
          const eff = effectiveAttemptWindow(
            td.valid_from_attempt, td.valid_to_attempt,
            td.subjects?.valid_from_attempt, td.subjects?.valid_to_attempt,
          );
          const hasMeta = eff.from || td.amendments_upto || td.important_qs_rev1 || td.important_qs_rev2;
          if (!hasMeta) return null;
          const lines = (s?: string | null) => (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
          return (
            <div className="card" style={{ marginTop: 18 }}>
              <h3 style={{ margin: "0 0 8px" }}>📋 Topic details</h3>
              <p className="muted" style={{ fontSize: ".88rem", margin: "0 0 6px" }}>
                {eff.from ? <>📅 Applicable from <strong>{eff.from}</strong>{eff.to ? <> to <strong>{eff.to}</strong></> : " onwards"}</> : null}
                {td.amendments_upto ? <> · 📝 Amendments up to <strong>{td.amendments_upto}</strong></> : null}
              </p>
              {td.important_qs_rev1 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: "pointer", color: "var(--accent)", fontWeight: 600 }}>📌 Most important questions — first revision</summary>
                  <ol style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: ".9rem" }}>
                    {lines(td.important_qs_rev1).map((q, i) => <li key={i} style={{ margin: "2px 0" }}>{q}</li>)}
                  </ol>
                </details>
              )}
              {td.important_qs_rev2 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: "pointer", color: "var(--accent)", fontWeight: 600 }}>📌 Most important questions — second revision</summary>
                  <ol style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: ".9rem" }}>
                    {lines(td.important_qs_rev2).map((q, i) => <li key={i} style={{ margin: "2px 0" }}>{q}</li>)}
                  </ol>
                </details>
              )}
            </div>
          );
        })()}

        {topicMaterials && topicMaterials.length > 0 && (
          <div className="card" style={{ marginTop: 18 }}>
            <h3 style={{ margin: "0 0 8px" }}>📚 Topic materials</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {topicMaterials.map((mt) => (
                <a key={mt.id} className="btn small secondary" href={`/learn/pdf?u=${encodeURIComponent(mt.file_url as string)}&t=Material`}>
                  {MAT_LABEL[mt.kind] ?? "📄"} {mt.title}
                </a>
              ))}
            </div>
          </div>
        )}

        {topicAmendments.length > 0 && (
          <div className="card" style={{ marginTop: 18, border: "2px solid var(--accent)" }}>
            <h3 style={{ margin: "0 0 10px" }}>📜 Amendments &amp; updates for your attempt</h3>
            <div style={{ display: "grid", gap: 12 }}>
              {topicAmendments.map((a) => (
                <div key={a.id} style={{ padding: "10px 12px", background: "var(--bg-soft)", borderRadius: 8 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong>{a.title}</strong>
                    {a.valid_from_attempt && <span className="badge">📅 From {a.valid_from_attempt}{a.valid_to_attempt ? ` to ${a.valid_to_attempt}` : " onwards"}</span>}
                  </div>
                  {a.body && <p style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{a.body}</p>}
                  {a.videoSrc && (
                    <div className="video-frame" style={{ marginTop: 10 }}>
                      <iframe src={a.videoSrc} allow="encrypted-media; fullscreen" allowFullScreen title={a.title} />
                    </div>
                  )}
                  {a.notes_hand_url && (
                    <a className="btn small secondary" href={`/learn/pdf?u=${encodeURIComponent(a.notes_hand_url)}&t=Amendment notes`} style={{ marginTop: 8, display: "inline-block" }}>✍️ Handwritten notes (PDF)</a>
                  )}
                  {a.discussion && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: "pointer", color: "var(--accent)" }}>🗣️ Discussion</summary>
                      <p style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{a.discussion}</p>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {sections.length > 0 ? (
          <>
            <p className="muted" style={{ fontSize: ".88rem", marginTop: 22, marginBottom: 8 }}>
              Tap any item below to open it.
            </p>
            {/* Admin-created Sections (named content groups), in order. */}
            {groupList.map((g) => {
              const items = sections.filter((s) => sectionGroupId.get(s.id) === g.id);
              if (!items.length) return null;
              return (
                <div key={g.id}>
                  {sectionGroupBanner(`📚 ${g.name}`, items.length, groupMins(items))}
                  <div className="sec-list">{items.map(renderSection)}</div>
                </div>
              );
            })}
            {/* Anything not put in a Section yet → grouped by type as a fallback. */}
            {SECTION_GROUP_ORDER.map((label) => {
              const items = sections.filter((s) => !sectionGroupId.get(s.id) && groupFor(s) === label);
              if (!items.length) return null;
              return (
                <div key={label}>
                  {sectionGroupBanner(label, items.length, groupMins(items))}
                  <div className="sec-list">{items.map(renderSection)}</div>
                </div>
              );
            })}
          </>
        ) : (
          <div className="card" style={{ marginTop: 22 }}>
            <p className="muted">No sections published in this topic yet.</p>
          </div>
        )}
      </section>
    </main>
  );
}
