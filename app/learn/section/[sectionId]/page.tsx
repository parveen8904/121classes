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
import UpgradeGate from "@/app/components/UpgradeGate";
import { checkQuota } from "@/lib/entitlements";

export const dynamic = "force-dynamic";
// Descriptive-paper grading reads two PDFs with Claude vision — allow time.
export const maxDuration = 60;

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
export default async function SectionPage(
  props: {
    params: Promise<{ sectionId: string }>;
    searchParams: Promise<{ view?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
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

  const { data: prof } = await supabase
    .from("profiles")
    .select("role, full_name, phone")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = prof?.role === "admin" || prof?.role === "faculty";

  // Free-plan quota on tests: a free student who's used their allowance sees an
  // Enroll screen. Already-attempted tests (refId) still open (to see the report).
  if ((section.type === "mcq_test" || section.type === "subjective_test") && !isAdmin) {
    const cat = section.type === "mcq_test" ? "mcq_test" : "descriptive_test";
    const q = await checkQuota(user.id, cat, section.id);
    if (!q.allowed) {
      const svc2 = createServiceClient();
      const { data: tp } = await svc2.from("topics").select("subject_id, subjects(course_id)").eq("id", section.topic_id).maybeSingle();
      const courseId = (tp?.subjects as { course_id?: string } | null)?.course_id ?? "";
      return (
        <UpgradeGate
          title={cat === "mcq_test" ? "MCQ tests" : "descriptive tests"}
          used={q.used}
          limit={q.limit}
          plansHref={courseId ? `/learn/${courseId}/plans?subject=${tp?.subject_id ?? ""}` : "/dashboard"}
          backHref={`/learn/topic/${section.topic_id}`}
          backLabel="← Back to topic"
        />
      );
    }
  }
  if (section.type === "mcq_test") return <McqSection section={section} />;
  if (section.type === "subjective_test") return <SubjectiveSection section={section} />;

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

  // Fair-usage: a student may watch a subject's recorded Bunny classes for a
  // total of (multiplier × raw class hours). Live classes aren't Bunny
  // recordings, so they're never counted. Admins/faculty are exempt.
  if (c.bunny_video_id && !isAdmin) {
    const { data: tRow } = await supabase.from("topics").select("subject_id").eq("id", section.topic_id).maybeSingle();
    const subjectId = (tRow as { subject_id?: string } | null)?.subject_id;
    if (subjectId) {
      const { data: fu } = await supabase.rpc("fair_use_status", { p_subject: subjectId });
      const row = Array.isArray(fu) ? fu[0] : fu;
      const budget = Number(row?.budget_seconds) || 0;
      const used = Number(row?.used_seconds) || 0;
      if (budget > 0 && used >= budget) {
        const hrs = (budget / 3600).toFixed(1);
        return (
          <main>
            <section className="container" style={{ paddingTop: 40, paddingBottom: 70, maxWidth: 620 }}>
              <p className="crumb"><Link href={`/learn/topic/${section.topic_id}`}>← Back to topic</Link></p>
              <div className="card" style={{ textAlign: "center", border: "2px solid var(--accent)" }}>
                <div style={{ fontSize: "2rem" }}>⏳</div>
                <h2 style={{ margin: "8px 0" }}>Fair-use watch limit reached</h2>
                <p className="muted">
                  To keep classes fair for everyone, recorded video watch time for this subject is capped
                  at about <strong>{hrs} hours</strong> (roughly twice the total class length). You&apos;ve
                  reached that limit for this subject.
                </p>
                <p className="muted" style={{ fontSize: ".85rem" }}>
                  Live classes are never counted. If you genuinely need more time, please contact us and we&apos;ll help.
                </p>
                <Link className="btn" href={`/learn/topic/${section.topic_id}`} style={{ marginTop: 8 }}>← Back to topic</Link>
              </div>
            </section>
          </main>
        );
      }
    }
  }

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
          <WatchTracker
            src={src}
            provider={c.bunny_video_id ? "bunny" : c.youtube_url ? "youtube" : "embed"}
            sectionId={section.id}
            durationSeconds={(Number(c.duration_minutes) || 0) * 60}
            topicId={section.topic_id}
            watermark={watermark}
          />
        ) : dl ? (
          <p className="muted" style={{ marginTop: 16 }}>📥 This class is available to download and watch securely in the desktop app.</p>
        ) : (
          <p className="muted" style={{ marginTop: 16 }}>Video coming soon.</p>
        )}

        {dl && <ClassDownload pv={dl} watermark={watermark} />}

        {(c.description || c.link_url) && (
          <div style={{ marginTop: 14 }}>
            {c.description && <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{c.description}</p>}
            {c.link_url && <a className="btn small secondary" href={c.link_url} target="_blank" rel="noopener noreferrer" style={{ marginTop: 8, display: "inline-block" }}>🔗 Open link</a>}
          </div>
        )}

        {/* Notes — handwritten notes shown prominently as asked. */}
        {(c.notes_hand_url || c.notes_typed_url || c.pdf_url || c.homework_solutions) && (
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            {/* All notes open in the in-app viewer: our URL only + moving student watermark. */}
            {c.notes_hand_url && <Link className="btn" href={`/learn/notes/${section.id}?kind=hand`}>✍️ Handwritten notes (PDF)</Link>}
            {c.notes_typed_url && <Link className="btn secondary" href={`/learn/notes/${section.id}?kind=typed`}>⌨️ Typed notes (PDF)</Link>}
            {c.pdf_url && <Link className="btn secondary" href={`/learn/notes/${section.id}?kind=pdf`}>📄 Class notes (PDF)</Link>}
            {c.homework_solutions && <Link className="btn secondary" href={`/learn/notes/${section.id}?kind=homework`}>✅ Homework solutions</Link>}
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
