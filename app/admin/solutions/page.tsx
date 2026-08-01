import SubmitButton from "@/app/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import { queueAllMissing, approveSolution, unapproveSolution, saveSolution, saveSolutionVideo, retrySolution, generateExplanations } from "./actions";

// Answer keys for the uploaded papers, and the button that makes them real.
// Nothing here is used by the portal or the evaluator until it is approved.

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  repo_item_id: string;
  solution_md: string | null;
  status: string;
  error: string | null;
  parts: number;
  edited: boolean;
  video_url: string | null;
  generated_at: string | null;
  repository_items: { title: string; kind: string; subjects: { title: string } | null } | null;
};

const LABEL: Record<string, string> = {
  queued: "⏳ Waiting to be drafted",
  drafting: "✍️ Being drafted now",
  drafted: "📝 Drafted — needs your approval",
  approved: "✅ Approved",
  failed: "⚠️ Draft failed",
};

export default async function AdminSolutionsPage(props: { searchParams: Promise<{ queued?: string; open?: string; mcq?: string; cases?: string }> }) {
  const searchParams = await props.searchParams;
  const svc = createServiceClient();

  const { data } = await svc
    .from("item_solutions")
    .select("id, repo_item_id, solution_md, status, error, parts, edited, video_url, generated_at, repository_items(title, kind, subjects(title))")
    .order("status")
    .limit(500);
  const rows = (data ?? []) as unknown as Row[];

  // How many papers still have no key at all (never queued).
  const { count: papers } = await svc
    .from("repository_items")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .eq("student_visible", true)
    .is("solution_url", null)
    .in("kind", ["mtp", "rtp", "past_papers"]);

  // How many answer explanations are still missing (the "why", not the answer).
  const { data: mcqKeys } = await svc.from("site_settings").select("key").like("key", "mcqx:%");
  const haveMcq = new Set((mcqKeys ?? []).map((k) => String(k.key).slice(5)));
  const { data: allMcq } = await svc.from("mcq_questions").select("id");
  const mcqMissing = (allMcq ?? []).filter((q) => !haveMcq.has(String(q.id))).length;
  const { count: caseMissing } = await svc
    .from("case_questions")
    .select("id", { count: "exact", head: true })
    .is("explanation", null);

  const byStatus = (s: string) => rows.filter((r) => r.status === s);
  const drafted = byStatus("drafted");
  const approved = byStatus("approved");
  const waiting = [...byStatus("queued"), ...byStatus("drafting")];
  const failed = byStatus("failed");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🗝️ Answer keys"
        title="Solutions for uploaded papers"
        subtitle="The descriptive tests (MTP / RTP / past papers) that have no answer key get an AI-drafted one. A key does nothing until you approve it — approved keys are what students see after they submit, and what the AI marks their answer books against."
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.queued && (
        <div className="notice ok">
          {searchParams.queued} paper{searchParams.queued === "1" ? "" : "s"} queued. Drafting runs in the background — refresh in a
          few minutes.
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
          <div><strong style={{ fontSize: "1.5rem" }}>{approved.length}</strong><div className="muted">approved</div></div>
          <div><strong style={{ fontSize: "1.5rem" }}>{drafted.length}</strong><div className="muted">awaiting your approval</div></div>
          <div><strong style={{ fontSize: "1.5rem" }}>{waiting.length}</strong><div className="muted">in the drafting queue</div></div>
          {failed.length > 0 && <div><strong style={{ fontSize: "1.5rem" }}>{failed.length}</strong><div className="muted">failed</div></div>}
          <div style={{ marginLeft: "auto" }}>
            <form action={queueAllMissing}>
              <SubmitButton className="btn" savedLabel="Queued…">✍️ Draft keys for the tests without one</SubmitButton>
            </form>
          </div>
        </div>
        <p className="muted" style={{ fontSize: ".85rem", marginTop: 10, marginBottom: 0 }}>
          {papers ?? 0} descriptive tests (MTP / RTP / past papers) currently have no answer key. Everything else — ICAI material, question banks, notes — already carries its solutions inside the file.
        </p>
      </div>

      {/* MCQ + case-study explanations — the answers exist, the "why" is what
          was never generated for some of them. */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 className="admin-section-title">❓ Answer explanations</h2>
        {searchParams.mcq && (
          <div className="notice ok">
            Wrote {searchParams.mcq} MCQ and {searchParams.cases ?? 0} case-study explanations. Press again to continue if any
            remain.
          </div>
        )}
        <p className="muted" style={{ fontSize: ".85rem", marginTop: 0 }}>
          Every question already has its correct answer. These are the one-line reasons shown in a student&apos;s report —{" "}
          <strong>{mcqMissing}</strong> chapter MCQs and <strong>{caseMissing ?? 0}</strong> case-study questions still have
          none.
        </p>
        {(mcqMissing > 0 || (caseMissing ?? 0) > 0) && (
          <form action={generateExplanations}>
            <SubmitButton className="btn small" savedLabel="Writing…">✍️ Generate the missing explanations</SubmitButton>
            <span className="muted" style={{ fontSize: ".8rem", marginLeft: 8 }}>
              Runs for about a minute per press; the nightly worker finishes the rest by itself.
            </span>
          </form>
        )}
      </div>

      {drafted.length === 0 && approved.length === 0 && waiting.length === 0 && (
        <div className="card">
          <p className="muted">
            No keys yet. Press the button above and the AI will draft an answer key for each descriptive test that has no
            solution file.
          </p>
        </div>
      )}

      {[...drafted, ...failed, ...waiting, ...approved].map((r) => {
        const item = r.repository_items;
        const open = searchParams.open === r.id;
        return (
          <div className="card" key={r.id} style={{ marginBottom: 14, borderColor: r.status === "approved" ? "#16a34a" : undefined }}>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
              <strong>{item?.title ?? "Paper"}</strong>
              <span className="badge">{item?.subjects?.title ?? "—"}</span>
              <span className="badge">{item?.kind ?? ""}</span>
              <span className="muted" style={{ marginLeft: "auto" }}>{LABEL[r.status] ?? r.status}{r.edited ? " · edited by you" : ""}</span>
            </div>

            {r.error && <p className="muted" style={{ color: "#b91c1c", fontSize: ".85rem" }}>{r.error}</p>}

            {r.solution_md && (
              <details open={open} style={{ marginTop: 10 }}>
                <summary className="btn as-btn small">
                  {r.status === "approved" ? "View the approved key" : "Read the draft before approving"}
                </summary>
                <form action={saveSolution} style={{ marginTop: 10 }}>
                  <input type="hidden" name="id" value={r.id} />
                  <textarea
                    name="solution_md"
                    defaultValue={r.solution_md}
                    rows={20}
                    style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: ".8rem" }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <SubmitButton className="btn small secondary" savedLabel="Saved">💾 Save edits</SubmitButton>
                    <SubmitButton className="btn small" savedLabel="Approved ✓" name="approve" value="1">
                      💾✅ Save and approve
                    </SubmitButton>
                  </div>
                </form>
              </details>
            )}

            <form action={saveSolutionVideo} style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input type="hidden" name="id" value={r.id} />
              <input
                name="video_url"
                defaultValue={r.video_url ?? ""}
                placeholder="🎥 Video solution link (YouTube / Bunny) — optional"
                style={{ flex: "1 1 320px", fontSize: ".85rem" }}
              />
              <SubmitButton className="btn small secondary" savedLabel="Saved">Save video link</SubmitButton>
            </form>

            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {r.status === "drafted" && (
                <form action={approveSolution}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton className="btn small" savedLabel="Approved ✓">✅ Approve as the final solution</SubmitButton>
                </form>
              )}
              {r.status === "approved" && (
                <form action={unapproveSolution}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton className="btn small secondary" savedLabel="Withdrawn">↩︎ Withdraw approval</SubmitButton>
                </form>
              )}
              {r.status === "failed" && (
                <form action={retrySolution}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton className="btn small secondary" savedLabel="Requeued">🔁 Try drafting again</SubmitButton>
                </form>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
