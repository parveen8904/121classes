import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { viaProxy } from "@/lib/fileProxy";
import PaperAnswerUpload from "./PaperAnswerUpload";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { mtp: "MTP", rtp: "RTP", past_papers: "Past exam paper" };

type Grade = {
  awarded: number; total: number; summary: string;
  per_question: { q: string; awarded: number; max: number; comment: string }[];
  improvements: string[]; concepts_to_revise: string[];
};

export default async function PaperPage(props: { params: Promise<{ itemId: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/learn/paper/${params.itemId}`);

  const svc = createServiceClient();
  const { data: item } = await svc
    .from("repository_items")
    .select("id, kind, title, file_url, solution_url, subject_id, is_active, student_visible, subjects(title, course_id)")
    .eq("id", params.itemId)
    .maybeSingle();
  if (!item || !item.is_active || !item.student_visible || !["mtp", "rtp", "past_papers"].includes(item.kind)) notFound();

  const { data: attempts } = await svc
    .from("paper_attempts")
    .select("id, status, awarded_marks, total_marks, report, submitted_at")
    .eq("repo_item_id", item.id)
    .eq("student_id", user.id)
    .order("submitted_at", { ascending: false });
  const latest = (attempts ?? [])[0] as { id: string; status: string; awarded_marks: number | null; total_marks: number | null; report: Grade | null; submitted_at: string } | undefined;

  const subj = (item as { subjects?: { title?: string; course_id?: string } | null }).subjects;
  const canEvaluate = !!item.solution_url;

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
        <p className="crumb">
          <Link href={subj?.course_id ? `/learn/${subj.course_id}` : "/dashboard"}>← {subj?.title ?? "Subject"}</Link>
        </p>
        <div className="learn-hero">
          <span className="badge">📝 {KIND_LABEL[item.kind]}</span>
          <h1 style={{ fontSize: "1.5rem" }}>{item.title}</h1>
          <p className="meta">Read the question paper, check the suggested answers, then upload your own answers for instant AI evaluation.</p>
        </div>

        {/* The papers */}
        <div className="card" style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {item.file_url && <a className="btn small secondary" href={viaProxy(item.file_url)} target="_blank" rel="noopener noreferrer">📄 Question paper</a>}
          {item.solution_url && <a className="btn small secondary" href={viaProxy(item.solution_url)} target="_blank" rel="noopener noreferrer">✅ Suggested answers</a>}
          {!item.solution_url && <span className="muted" style={{ fontSize: ".85rem", alignSelf: "center" }}>Suggested answers coming soon.</span>}
        </div>

        {/* Upload / evaluate */}
        <div className="card" style={{ marginTop: 14 }}>
          <strong>✍️ Attempt this paper</strong>
          <p className="muted" style={{ fontSize: ".85rem", margin: "6px 0 10px" }}>
            {canEvaluate
              ? "Write your answers, then upload a PDF or clear photos of your handwritten pages. Our AI checks them against the suggested answers and gives you marks + feedback."
              : "Upload your answers — your faculty will review them (AI evaluation switches on once suggested answers are added)."}
          </p>
          <PaperAnswerUpload itemId={item.id} canEvaluate={canEvaluate} />
        </div>

        {/* Latest result */}
        {latest && (
          <div className="card" style={{ marginTop: 14, borderLeft: "4px solid var(--accent)" }}>
            {latest.status === "graded" && latest.report ? (
              <>
                <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#16a34a" }}>
                  Your score: {latest.report.awarded} / {latest.report.total}
                </div>
                {latest.report.summary && <p style={{ marginTop: 6 }}>{latest.report.summary}</p>}
                {latest.report.per_question?.length > 0 && (
                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    {latest.report.per_question.map((q, i) => (
                      <div key={i} style={{ background: "var(--bg-soft)", borderRadius: 8, padding: "8px 12px" }}>
                        <strong style={{ fontSize: ".9rem" }}>{q.q} — {q.awarded}/{q.max}</strong>
                        {q.comment && <p className="muted" style={{ fontSize: ".84rem", margin: "2px 0 0" }}>{q.comment}</p>}
                      </div>
                    ))}
                  </div>
                )}
                {latest.report.concepts_to_revise?.length > 0 && (
                  <p className="muted" style={{ fontSize: ".85rem", marginTop: 10 }}>📚 Revise: {latest.report.concepts_to_revise.join(", ")}</p>
                )}
                <p style={{ marginTop: 10, fontSize: ".82rem", background: "rgba(234,179,8,.12)", borderRadius: 8, padding: "6px 10px" }}>
                  ⚠️ Beta — AI marking can make mistakes; treat it as guidance and confirm with faculty.
                </p>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>✅ Your answers were submitted{canEvaluate ? " — evaluation is being prepared, refresh in a moment." : "; your faculty will review them."}</p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
