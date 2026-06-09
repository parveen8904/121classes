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
  pdf: "PDF",
  rich_text: "Notes",
  past_papers: "Past papers",
  live_class: "Live class",
  ask_doubt: "Ask a doubt",
  mcq_test: "MCQ test",
  subjective_test: "Subjective test",
  custom: "Section",
};

function SectionBody({ type, config }: { type: string; config: Record<string, unknown> | null }) {
  const c = (config ?? {}) as Record<string, string>;

  if (type === "revision_video" || type === "full_class_video" || type === "custom") {
    const src = videoEmbedSrc(config);
    return (
      <>
        {src ? (
          <div className="video-frame" style={{ marginTop: 14 }}>
            <iframe src={src} allow="encrypted-media; fullscreen" allowFullScreen title="Video" />
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 10 }}>
            Video coming soon.
          </p>
        )}
        {c.body && <p style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{c.body}</p>}
      </>
    );
  }

  if (type === "pdf" || type === "past_papers") {
    return (
      <div style={{ marginTop: 12 }}>
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
      <p style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{c.body}</p>
    ) : (
      <p className="muted" style={{ marginTop: 12 }}>
        Notes coming soon.
      </p>
    );
  }

  if (type === "live_class") {
    return (
      <div style={{ marginTop: 12 }}>
        {c.starts_at && <p className="muted">Starts: {c.starts_at}</p>}
        {c.join_url ? (
          <a className="btn small" href={c.join_url} target="_blank" rel="noopener noreferrer">
            Join live class
          </a>
        ) : (
          <p className="muted">Join link will appear here before the session.</p>
        )}
      </div>
    );
  }

  if (type === "ask_doubt") {
    return (
      <div style={{ marginTop: 12 }}>
        <textarea rows={3} placeholder="Type your doubt…" disabled />
        <p className="muted" style={{ fontSize: ".85rem" }}>
          AI doubt-solving is being wired up (Phase 7). Your tutor reviews answers under CA Parveen
          Sharma&apos;s guidance.
        </p>
      </div>
    );
  }

  if (type === "mcq_test" || type === "subjective_test") {
    return (
      <p className="muted" style={{ marginTop: 12 }}>
        Test will be available here (Phase 7).
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

  // Metadata for ALL published sections (incl. locked) + unlocked flag.
  const { data: metas } = await supabase.rpc("list_topic_sections", { p_topic: topic.id });

  // Full rows (with config) for sections the RLS lets this user read = unlocked ones.
  const { data: accessRows } = await supabase
    .from("sections")
    .select("id, config")
    .eq("topic_id", topic.id);
  const configById = new Map<string, Record<string, unknown> | null>(
    (accessRows ?? []).map((r) => [r.id, r.config as Record<string, unknown> | null]),
  );

  const sections = (metas ?? []) as SectionMeta[];
  const subject = (topic as { subjects?: { title?: string; course_id?: string } | null }).subjects;

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
          {subject?.course_id ? (
            <Link className="muted" href={`/learn/${subject.course_id}`}>
              ← {subject?.title ?? "Subject"}
            </Link>
          ) : (
            <Link className="muted" href="/dashboard">
              ← Dashboard
            </Link>
          )}
        </p>
        <h1 style={{ marginBottom: 18 }}>{topic.title}</h1>

        {sections.length > 0 ? (
          <div style={{ display: "grid", gap: 16 }}>
            {sections.map((s) => {
              const locked = !s.unlocked;
              return (
                <div className="card" key={s.id} style={{ opacity: locked ? 0.85 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <h3 style={{ fontSize: "1.1rem" }}>{s.title}</h3>
                    <span className="badge">{TYPE_LABEL[s.type] ?? s.type}</span>
                    {locked && (
                      <span className="badge" style={{ background: "var(--bg-soft)" }}>
                        🔒 {s.min_plan ? PLAN_LABEL[s.min_plan] ?? s.min_plan : "Locked"}
                      </span>
                    )}
                  </div>

                  {locked ? (
                    <p className="muted" style={{ marginTop: 10 }}>
                      Unlock this with a{" "}
                      <strong>{s.min_plan ? PLAN_LABEL[s.min_plan] ?? s.min_plan : "paid"}</strong> plan
                      for this course.
                    </p>
                  ) : (
                    <SectionBody type={s.type} config={configById.get(s.id) ?? null} />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card">
            <p className="muted">No sections published in this topic yet.</p>
          </div>
        )}
      </section>
    </main>
  );
}
