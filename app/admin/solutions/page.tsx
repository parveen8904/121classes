import SubmitButton from "@/app/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import { queueAllMissing, approveSolution, unapproveSolution, saveSolution, retrySolution } from "./actions";

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

export default async function AdminSolutionsPage(props: { searchParams: Promise<{ queued?: string; open?: string }> }) {
  const searchParams = await props.searchParams;
  const svc = createServiceClient();

  const { data } = await svc
    .from("item_solutions")
    .select("id, repo_item_id, solution_md, status, error, parts, edited, generated_at, repository_items(title, kind, subjects(title))")
    .order("status")
    .limit(500);
  const rows = (data ?? []) as unknown as Row[];

  // How many papers still have no key at all (never queued).
  const { count: papers } = await svc
    .from("repository_items")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .is("solution_url", null)
    .in("kind", ["icai", "question_bank", "rtp", "mtp", "past_papers", "custom"]);

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
        subtitle="Papers with no suggested-answers PDF get an AI-drafted key. A key does nothing until you approve it — approved keys are what students see and what the AI marks descriptive answer books against."
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
              <SubmitButton className="btn" savedLabel="Queued…">✍️ Draft keys for every paper without one</SubmitButton>
            </form>
          </div>
        </div>
        <p className="muted" style={{ fontSize: ".85rem", marginTop: 10, marginBottom: 0 }}>
          {papers ?? 0} active papers currently have no suggested-answers PDF.
        </p>
      </div>

      {drafted.length === 0 && approved.length === 0 && waiting.length === 0 && (
        <div className="card">
          <p className="muted">
            No keys yet. Press the button above and the AI will draft an answer key for every uploaded paper that has no
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
