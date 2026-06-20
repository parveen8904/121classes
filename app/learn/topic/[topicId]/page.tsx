import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { videoEmbedSrc } from "../../_lib/media";
import { bunnyEmbedUrl } from "@/lib/bunny";
import DoubtBox from "./DoubtBox";
import ClassDownload from "./ClassDownload";
import DiscussionBoard from "../../section/[sectionId]/DiscussionBoard";
import Help from "@/app/components/Help";

type Downloadable = {
  id: string;
  section_id: string | null;
  storage_url: string;
  iv_b64: string | null;
  alg: string | null;
  byte_size: number | null;
};

export const dynamic = "force-dynamic";

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
    return (
      <>
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
            {c.pdf_url && (
              <a className="btn small secondary" href={c.pdf_url} target="_blank" rel="noopener noreferrer">📄 Class notes (PDF)</a>
            )}
            {c.notes_hand_url && (
              <a className="btn small secondary" href={c.notes_hand_url} target="_blank" rel="noopener noreferrer">✍️ Handwritten notes</a>
            )}
            {c.notes_typed_url && (
              <a className="btn small secondary" href={c.notes_typed_url} target="_blank" rel="noopener noreferrer">⌨️ Typed notes</a>
            )}
            {c.homework_solutions && (
              <a className="btn small secondary" href={c.homework_solutions} target="_blank" rel="noopener noreferrer">✅ Homework solutions</a>
            )}
          </div>
        )}
        {c.homework && (
          <div style={{ marginTop: 12 }}>
            <strong style={{ fontSize: ".9rem" }}>📚 Homework</strong>
            <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{c.homework}</p>
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
            <a className="btn small secondary" href={`/learn/notes/${id}/pdf`} target="_blank" rel="noopener noreferrer" style={{ marginTop: 8, display: "inline-block" }}>
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
            href={c.pdf_url}
            target="_blank"
            rel="noopener noreferrer"
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
          <a className="btn small" href={c.pdf_url} target="_blank" rel="noopener noreferrer">
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
          <a className="btn small secondary" href={c.pdf_url} target="_blank" rel="noopener noreferrer">📄 Question paper (PDF)</a>
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
    .select("id, title, subject_id, weightage_marks, importance, important_qs_rev1, update_coming, update_on, update_for, update_note, subjects(title, course_id)")
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
  let sections: SectionMeta[] = [];

  if (isAdmin) {
    // Service client → every published section, fully unlocked, with its content.
    const { data: rows } = await createServiceClient()
      .from("sections")
      .select("id, type, title, order_index, min_plan, config")
      .eq("topic_id", topic.id)
      .eq("is_published", true)
      .order("order_index")
      .order("title");
    for (const r of rows ?? []) {
      configById.set(r.id, r.config as Record<string, unknown> | null);
      sections.push({ id: r.id, type: r.type, title: r.title, order_index: r.order_index, min_plan: r.min_plan, unlocked: true });
    }
  } else {
    // Students: RPC marks paid sections locked; RLS gives config for unlocked ones.
    const { data: metas, error: metaErr } = await supabase.rpc("list_topic_sections", { p_topic: topic.id });
    const { data: accessRows } = await supabase
      .from("sections")
      .select("id, type, title, order_index, min_plan, is_published, config")
      .eq("topic_id", topic.id)
      .eq("is_published", true)
      .order("order_index")
      .order("title");
    for (const r of accessRows ?? []) configById.set(r.id, r.config as Record<string, unknown> | null);
    sections =
      !metaErr && metas
        ? (metas as SectionMeta[])
        : (accessRows ?? []).map((r) => ({ id: r.id, type: r.type, title: r.title, order_index: r.order_index, min_plan: r.min_plan, unlocked: true }));
  }

  // Encrypted classes the student may download, keyed by section (for the
  // "Download for offline" button on the class).
  const { data: dlRows } = await supabase.rpc("list_downloadable_classes");
  const downloadBySection = new Map<string, Downloadable>();
  for (const d of (dlRows ?? []) as Downloadable[]) {
    if (d.section_id) downloadBySection.set(d.section_id, d);
  }

  const subject = (topic as { subjects?: { title?: string; course_id?: string } | null }).subjects;
  const courseId = subject?.course_id;

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
          <span className="badge">📖 Topic</span>
          <h1>{topic.title}</h1>
          <p className="meta">
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

        {sections.length > 0 ? (
          <div className="sec-list" style={{ marginTop: 22 }}>
            {sections.map((s) => {
              const locked = !s.unlocked;
              const planName = s.min_plan ? PLAN_LABEL[s.min_plan] ?? s.min_plan : "a paid";
              return (
                <div className={`sec-card${locked ? " lock-card" : ""}`} key={s.id}>
                  <div className="sec-head">
                    <span className="sec-ic">{TYPE_ICON[s.type] ?? "📦"}</span>
                    <div>
                      <div className="sec-title">{s.title}</div>
                      <div className="sec-type">{TYPE_LABEL[s.type] ?? s.type}</div>
                    </div>
                    {locked && (
                      <span className="lock-badge" style={{ marginLeft: "auto" }}>
                        🔒 {s.min_plan ? PLAN_LABEL[s.min_plan] : "Locked"}
                      </span>
                    )}
                  </div>

                  {locked ? (
                    <div className="lock-row">
                      <span className="txt">
                        This is part of the <strong>{planName}</strong> plan. Upgrade to unlock it for
                        every topic in this course.
                      </span>
                      <Link className="btn small" href={plansHref}>
                        Upgrade →
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
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card" style={{ marginTop: 22 }}>
            <p className="muted">No sections published in this topic yet.</p>
          </div>
        )}
      </section>
    </main>
  );
}
