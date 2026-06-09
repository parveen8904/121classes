import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { videoEmbedSrc } from "../../_lib/media";

export const dynamic = "force-dynamic";

type SectionMeta = {
  id: string;
  type: string;
  title: string;
  order_index: number;
  min_plan: string | null;
  unlocked: boolean;
};

const PLAN_LABEL: Record<string, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold" };
const TYPE_LABEL: Record<string, string> = {
  revision_video: "Revision video",
  full_class_video: "Full class video",
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
  full_class_video: "🎥",
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
}: {
  id: string;
  type: string;
  config: Record<string, unknown> | null;
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
    const src = videoEmbedSrc(config);
    return (
      <>
        {src ? (
          <div className="video-frame" style={{ marginTop: 14 }}>
            <iframe src={src} allow="encrypted-media; fullscreen" allowFullScreen title="Video" />
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 12 }}>
            Video coming soon.
          </p>
        )}
        {c.body && <p style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{c.body}</p>}
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
    return (
      <div style={{ marginTop: 14 }}>
        {c.starts_at && <p className="muted">Starts: {c.starts_at}</p>}
        {c.join_url ? (
          <a className="btn small" href={c.join_url} target="_blank" rel="noopener noreferrer">
            Join live class
          </a>
        ) : (
          <p className="muted">The join link appears here before the session.</p>
        )}
      </div>
    );
  }

  if (type === "ask_doubt") {
    return (
      <div style={{ marginTop: 14 }}>
        <textarea rows={3} placeholder="Type your doubt…" disabled />
        <p className="muted" style={{ fontSize: ".85rem" }}>
          AI doubt-solving is being wired up. Your answers are reviewed under CA Parveen
          Sharma&apos;s guidance.
        </p>
      </div>
    );
  }

  if (type === "mcq_test" || type === "subjective_test") {
    return (
      <p className="muted" style={{ marginTop: 14 }}>
        This test will open here soon.
      </p>
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
    .select("id, title, subject_id, subjects(title, course_id)")
    .eq("id", params.topicId)
    .single();
  if (!topic) notFound();

  // Primary path: list_topic_sections() returns metadata for ALL published
  // sections (incl. locked) so we can show upgrade teasers.
  const { data: metas, error: metaErr } = await supabase.rpc("list_topic_sections", {
    p_topic: topic.id,
  });

  // Rows the RLS lets this user read (admins: all published; students: free +
  // subscribed) — gives us `config` for unlocked sections, and doubles as a
  // fallback list if the RPC isn't deployed yet.
  const { data: accessRows } = await supabase
    .from("sections")
    .select("id, type, title, order_index, min_plan, is_published, config")
    .eq("topic_id", topic.id)
    .eq("is_published", true)
    .order("order_index")
    .order("title");
  const configById = new Map<string, Record<string, unknown> | null>(
    (accessRows ?? []).map((r) => [r.id, r.config as Record<string, unknown> | null]),
  );

  const sections: SectionMeta[] =
    !metaErr && metas
      ? (metas as SectionMeta[])
      : (accessRows ?? []).map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          order_index: r.order_index,
          min_plan: r.min_plan,
          unlocked: true, // RLS already filtered to what this user may read
        }));
  const subject = (topic as { subjects?: { title?: string; course_id?: string } | null }).subjects;
  const courseId = subject?.course_id;
  const plansHref = courseId ? `/learn/${courseId}/plans` : "/dashboard";

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
          </p>
        </div>

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
                    <SectionBody id={s.id} type={s.type} config={configById.get(s.id) ?? null} />
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
