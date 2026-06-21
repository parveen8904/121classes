import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { videoEmbedSrc } from "../../_lib/media";
import { bunnyEmbedUrl } from "@/lib/bunny";
import DiscussionSection from "./DiscussionSection";
import McqSection from "./McqSection";
import SubjectiveSection from "./SubjectiveSection";
import DiscussionBoard from "./DiscussionBoard";
import ClassDownload from "../../topic/[topicId]/ClassDownload";
import WatchTracker from "./WatchTracker";

export const dynamic = "force-dynamic";

type Downloadable = { id: string; section_id: string | null; storage_url: string; iv_b64: string | null; alg: string | null; byte_size: number | null };

function fmtMins(mins: number): string {
  const m = Math.max(0, Math.round(mins || 0));
  if (!m) return "";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

// Video sections open here on their OWN focused page — only this class, with a
// clear "← Back to topic" link. Other classes are NOT listed (students return to
// the topic page for those).
const VIDEO_NAV = new Set(["full_class_video", "revision_video", "discussion_video", "custom"]);

// One route, dispatched by section type. RLS only returns the section if the
// student may access it (free or subscribed) — locked ones 404 back to topic.
export default async function SectionPage({
  params,
  searchParams,
}: {
  params: { sectionId: string };
  searchParams: { view?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/learn/section/${params.sectionId}`);

  const { data: section } = await supabase
    .from("sections")
    .select("id, title, type, topic_id")
    .eq("id", params.sectionId)
    .maybeSingle();
  if (!section) notFound();

  if (section.type === "mcq_test") return <McqSection section={section} />;
  if (section.type === "subjective_test") return <SubjectiveSection section={section} />;

  const { data: prof } = await supabase
    .from("profiles")
    .select("role, full_name, phone")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = prof?.role === "admin" || prof?.role === "faculty";

  if (section.type === "discussion" || searchParams.view === "discussion") {
    return <DiscussionSection section={section} userId={user.id} isAdmin={prof?.role === "admin"} />;
  }

  // Non-video content types stay inline on the topic page.
  if (!VIDEO_NAV.has(section.type)) redirect(`/learn/topic/${section.topic_id}`);

  // Config — admins/faculty preview via the service client; students via RLS.
  const cfgClient = isAdmin ? createServiceClient() : supabase;
  const { data: cfgRow } = await cfgClient.from("sections").select("config").eq("id", section.id).maybeSingle();
  const c = (cfgRow?.config ?? {}) as Record<string, string>;

  const watermark = [prof?.full_name, user.email ?? prof?.phone].filter(Boolean).join(" · ");
  const { data: dlRows } = await supabase.rpc("list_downloadable_classes");
  const dl = ((dlRows ?? []) as Downloadable[]).find((d) => d.section_id === section.id) ?? null;

  const src = c.bunny_video_id ? bunnyEmbedUrl(c.bunny_video_id, c.bunny_drm !== "off") : videoEmbedSrc(cfgRow?.config ?? null);
  const isRev = section.type === "revision_video";
  const numLabel = c.class_no ? (isRev ? `Revision ${c.class_no}` : `Class ${c.class_no}`) : "";
  const dur = fmtMins(Number(c.duration_minutes));
  const concepts = (c.ai_concepts_discussed ?? "").split("\n").filter(Boolean);
  const questions = (c.ai_questions_discussed ?? "").split("\n").filter(Boolean);

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
        <p className="crumb">
          <Link href={`/learn/topic/${section.topic_id}`}>← Back to topic (all classes)</Link>
        </p>

        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>{section.title}</h1>
          {numLabel && <span style={{ fontWeight: 700, fontSize: "1.1rem" }}>{numLabel}</span>}
          {dur && <span className="muted">⏱️ {dur}</span>}
        </div>

        {src ? (
          <WatchTracker src={src} sectionId={section.id} durationSeconds={(Number(c.duration_minutes) || 0) * 60} topicId={section.topic_id} watermark={watermark} />
        ) : dl ? (
          <p className="muted" style={{ marginTop: 16 }}>📥 This class is available to download and watch securely in the desktop app.</p>
        ) : (
          <p className="muted" style={{ marginTop: 16 }}>Video coming soon.</p>
        )}

        {dl && <ClassDownload pv={dl} watermark={watermark} />}

        {/* Notes — handwritten notes shown prominently as asked. */}
        {(c.notes_hand_url || c.notes_typed_url || c.pdf_url || c.homework_solutions) && (
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            {c.notes_hand_url && <a className="btn" href={c.notes_hand_url} target="_blank" rel="noopener noreferrer">✍️ Handwritten notes (PDF)</a>}
            {c.notes_typed_url && <a className="btn secondary" href={c.notes_typed_url} target="_blank" rel="noopener noreferrer">⌨️ Typed notes (PDF)</a>}
            {c.pdf_url && <a className="btn secondary" href={c.pdf_url} target="_blank" rel="noopener noreferrer">📄 Class notes (PDF)</a>}
            {c.homework_solutions && <a className="btn secondary" href={c.homework_solutions} target="_blank" rel="noopener noreferrer">✅ Homework solutions</a>}
          </div>
        )}

        {/* Class summary — prominent (always open, not hidden). */}
        {c.ai_summary && (
          <div className="card" style={{ marginTop: 18, border: "2px solid var(--accent)" }}>
            <h3 style={{ marginTop: 0 }}>📋 Class summary</h3>
            <p style={{ marginTop: 0 }}>{c.ai_summary}</p>
            {concepts.length > 0 && (
              <p style={{ margin: "6px 0" }}><strong>🔑 Concepts covered:</strong> {concepts.join(" · ")}</p>
            )}
            {questions.length > 0 && (
              <p style={{ margin: "6px 0" }}><strong>❓ Questions discussed:</strong> {questions.join(" · ")}</p>
            )}
            <p style={{ margin: "6px 0 0" }}>
              <strong>📝 {Number(c.ai_homework_count) || 0} homework questions</strong> solved in class
              {c.ai_homework_next ? <> · <strong>Homework for next class:</strong> {c.ai_homework_next}</> : null}
            </p>
          </div>
        )}

        {c.homework && (
          <div className="card" style={{ marginTop: 14 }}>
            <strong>📚 Homework</strong>
            <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{c.homework}</p>
          </div>
        )}

        <div style={{ marginTop: 22 }}>
          <h3 style={{ fontSize: "1rem", marginBottom: 10 }}>💬 Comments</h3>
          <DiscussionBoard
            sectionId={section.id}
            userId={user.id}
            isAdmin={prof?.role === "admin"}
            returnPath={`/learn/section/${section.id}`}
            promptLabel="Add a comment"
            placeholder="Ask a question or share a thought…"
          />
        </div>
      </section>
    </main>
  );
}
