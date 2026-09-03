import { assertArea, currentStaff } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { zohoConfigured } from "@/lib/zohoApi";
import { entryForApproval } from "@/lib/approvalEntry";
import EntryLines from "../EntryLines";
import SubmitButton from "@/app/components/SubmitButton";
import DeskShell from "../_shell";
import { approveZohoAction, approveAllZohoAction, rejectZohoAction, retryApprovalAction } from "../actions";

// HIS GATE, ON ITS OWN PAGE.
//
// The one thing on this desk only he can do, and on the old single page it sat
// behind everything else's data loading. Now it is a link he can be sent.

export const dynamic = "force-dynamic";

export default async function ApprovalsPage(props: { searchParams: Promise<{ scan?: string }> }) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const hubConnected = await zohoConfigured();
  // The gate's second key, handed out by name — see zoho_approve in
  // lib/adminAccess.ts. The approval UI renders for either.
  const staff = await currentStaff();
  const canApprove = staff?.role === "admin" || !!staff?.permissions.includes("zoho_approve");
  // Holding the grant is the whole answer to "may I release this", including
  // one's own requests — the founder's ruling, 3 September. Who ASKED is still
  // shown on every row, because the record should answer that afterwards.

  const { listPending, listFailed } = await import("@/lib/zohoApprovals");
  const pendingApprovals = hubConnected ? await listPending() : [];
  // Releases that were refused. They leave the pending list the moment they
  // fail, so without this the gate falls silent and the work looks done.
  const failedApprovals = hubConnected ? await listFailed() : [];
  // Approved by him, waiting only on Zoho's per-minute allowance — so an
  // emptying queue looks like progress rather than silence.
  const { count: queuedCount } = hubConnected
    ? await createServiceClient().from("zoho_approvals").select("id", { count: "exact", head: true }).eq("status", "queued")
    : { count: 0 };

  // The entry behind each one, worked out before the gate is drawn: he should
  // not have to open anything to see what releasing an item does to the
  // ledgers. Where one cannot be derived honestly the item carries no table —
  // never an invented one beside an approve button.
  const approvalEntries = new Map<string, Awaited<ReturnType<typeof entryForApproval>>>();
  await Promise.all(pendingApprovals.map(async (a) => {
    approvalEntries.set(String(a.id), await entryForApproval({
      kind: String(a.kind), ref_table: String(a.ref_table), ref_id: String(a.ref_id),
      details: (a.details ?? null) as Record<string, unknown> | null,
    }));
  }));

  return (
    <DeskShell
      badge="✋ Your approval gate"
      title="Waiting for your approval"
      subtitle="Nothing reaches Zoho until you release it here. Each item shows the entry it will write before you decide."
      current="/admin/zoho/approvals"
      message={sp.scan}
    >

  <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 10px" }}>
    Nothing is written to Zoho from anywhere in this system — no posting, no date, no amount, no vendor,
    no TDS — until you release it here. The desk prepares the work and asks; this page is the only door,
    and it is <strong>yours alone</strong>. Everything below shows exactly what will be sent.
  </p>

  {(queuedCount ?? 0) > 0 && (
    <div className="card" style={{ marginBottom: 10, borderLeft: "4px solid var(--accent)" }}>
      <strong style={{ fontSize: ".92rem" }}>⏳ {queuedCount} approved and posting themselves</strong>
      <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 0", lineHeight: 1.6 }}>
        You have already released these. Zoho accepts 100 calls a minute for the whole organisation, so they
        go a few at a time and clear over the next minutes. <strong>Nothing further is needed from you</strong> —
        this number falls on its own.
      </p>
    </div>
  )}

  {failedApprovals.length > 0 && (
    <div className="card" style={{ marginBottom: 10, borderLeft: "4px solid #b91c1c" }}>
      <strong style={{ fontSize: ".92rem", color: "#b91c1c" }}>
        ⚠ {failedApprovals.length} you released did not post
      </strong>
      <p className="muted" style={{ fontSize: ".8rem", margin: "6px 0 10px", lineHeight: 1.6 }}>
        Zoho refused these, so nothing was written. Deal with the reason, then send each back to the gate.
      </p>
      {failedApprovals.map((f) => (
        <div key={f.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
          <div style={{ flex: "1 1 420px" }}>
            <div style={{ fontSize: ".88rem" }}>{f.summary}</div>
            <div style={{ fontSize: ".78rem", color: "#b91c1c", marginTop: 2 }}>{f.result?.error ?? "no reason recorded"}</div>
          </div>
          <form action={retryApprovalAction} style={{ margin: 0 }}>
            <input type="hidden" name="id" value={f.id} />
            <SubmitButton className="btn small secondary" savedLabel="✓">↻ Back to the gate</SubmitButton>
          </form>
        </div>
      ))}
    </div>
  )}

  {pendingApprovals.length === 0 ? (
    <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing waiting. The books are as you left them.</p></div>
  ) : !canApprove ? (
    <div className="card">
      <p className="muted" style={{ margin: 0 }}>
        {pendingApprovals.length} item(s) are with CA Parveen Sharma for approval. They post once he releases them.
      </p>
    </div>
  ) : (
    <>
      <form action={approveAllZohoAction} className="card" style={{ marginBottom: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {pendingApprovals.map((a) => <input key={a.id} type="hidden" name="ids" value={a.id} />)}
        <SubmitButton className="btn small" savedLabel="Posted">
          {pendingApprovals.length === 1 ? "✅ Approve and post" : `✅ Approve all ${pendingApprovals.length} and post`}
        </SubmitButton>
        <span className="muted" style={{ fontSize: ".8rem" }}>Or go through them one at a time below.</span>
      </form>

      {pendingApprovals.map((a) => (
        <div className="card" key={a.id} style={{ marginTop: 8, borderLeft: "4px solid #b45309" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 420px" }}>
              <span className="muted" style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".06em" }}>
                {a.kind.replace(/_/g, " ")}
                {/* WHO WANTS THIS. The gate showed what was being asked for and
                    never by whom. It does not decide anything — the grant does
                    that — but a record that cannot say who asked is a poor
                    record. */}
                {a.requested_by_name && (
                  <span style={{ textTransform: "none", letterSpacing: 0 }}> · asked by {a.requested_by_name}</span>
                )}
              </span>
              <div style={{ fontSize: ".95rem", marginTop: 2 }}>{a.summary}</div>
              {(() => {
                const e = approvalEntries.get(String(a.id));
                return e
                  ? <EntryLines entry={e} title="What approving this does to the ledgers" compact />
                  : a.kind === "attach_paper" ? (
                    <p className="muted" style={{ fontSize: ".78rem", margin: "6px 0 0", lineHeight: 1.6 }}>
                      📎 No ledger changes. Releasing this files the invoice PDF against a bill already in Zoho —
                      nothing is debited, credited or re-dated.
                    </p>
                  ) : (
                    <p className="muted" style={{ fontSize: ".76rem", margin: "6px 0 0" }}>
                      The entry for this one cannot be shown here — open it on its own section below before you release it.
                    </p>
                  );
              })()}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <form action={approveZohoAction} style={{ margin: 0 }}>
                <input type="hidden" name="id" value={a.id} />
                <SubmitButton className="btn small" savedLabel="Posted">✅ Approve</SubmitButton>
              </form>
              <form action={rejectZohoAction} style={{ margin: 0 }}>
                <input type="hidden" name="id" value={a.id} />
                <SubmitButton className="btn small secondary" savedLabel="Rejected">✕ No</SubmitButton>
              </form>
            </div>
          </div>
        </div>
      ))}
    </>
  )}
    </DeskShell>
  );
}
