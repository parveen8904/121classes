import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { zohoConfigured } from "@/lib/zohoApi";
import { formatINR } from "@/lib/pricing";
import { listZohoAccounts } from "@/lib/bankStatements";
import SubmitButton from "@/app/components/SubmitButton";
import DeskShell from "../_shell";
import { scanSettlementsAction } from "../actions";

// RAZORPAY SETTLEMENTS — a cross-check since 2 September 2026, when the bank
// statement became the only route to the deposit.

export const dynamic = "force-dynamic";

type SettleRow = { id: string; settlement_id: string; utr: string | null; settled_on: string;
  net_inr: number; fees_inr: number; tax_inr: number; gross_inr: number; status: string; error: string | null };

export default async function SettlementsPage(props: { searchParams: Promise<{ scan?: string }> }) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const hubConnected = await zohoConfigured();

  const { data: settleData } = hubConnected
    ? await createServiceClient().from("zoho_settlements")
        .select("id, settlement_id, utr, settled_on, net_inr, fees_inr, tax_inr, gross_inr, status, error")
        .order("settled_on", { ascending: false })
    : { data: [] as SettleRow[] };
  const settles = (settleData ?? []) as SettleRow[];
  const sBy = (s: string) => settles.filter((x) => x.status === s);
  const sPosted = sBy("posted"); const sMatched = sBy("matched"); const sRecord = sBy("record");
  const zohoAccounts = hubConnected ? await listZohoAccounts().catch(() => []) : [];
  const allAccountNames = zohoAccounts.map((a) => a.name);

  return (
    <DeskShell
      badge="🏦 Razorpay settlements"
      title="Settlements"
      subtitle="A cross-check only. The bank statement books the deposit into Razorpay Clearing, and that is the single route."
      current="/admin/zoho/settlements"
      message={sp.scan}
    >

  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 26 }}>
    <form action={scanSettlementsAction} style={{ margin: 0 }}>
      <SubmitButton className="btn small secondary" savedLabel="Scanned">🔄 Fetch settlements</SubmitButton>
    </form>
    <span className="muted" style={{ fontSize: ".8rem" }}>{sRecord.length} recorded · {sPosted.length} posted before the change · {sMatched.length} matched</span>
  </div>
  {/* WHY THIS QUEUE NO LONGER POSTS. His instruction, 2 Sep:
      "remove razorpay clearing since bank statement already includes".
      All 114 settlements carry a zero fee — Razorpay bills its charges
      separately — so the journal this made was Dr bank, Cr Razorpay
      Clearing, which is exactly what the bank line posts. Two routes to
      one entry double-counted twice in a fortnight. */}
  <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 10px" }}>
    <strong>Nothing posts from here.</strong> The bank statement books the deposit into Razorpay Clearing, and
    that is the only route — Razorpay reports a zero fee on every settlement, so there was never a second leg
    for this to add. What it still does is record what Razorpay says, so a deposit can be checked against the
    books. Razorpay Clearing itself is unchanged: the sale receipt goes in when the student pays, the bank
    statement takes it out when the money lands.
  </p>

  {sRecord.length > 0 && (
    <details style={{ marginBottom: 8 }}>
      <summary className="btn small secondary as-btn">📄 Recorded ({sRecord.length})</summary>
      <div style={{ display: "grid", gap: 3, marginTop: 8 }}>
        {sRecord.slice(0, 60).map((r) => (
          <div key={r.id} style={{ display: "flex", gap: 10, fontSize: ".8rem", padding: "4px 10px", background: "var(--bg-soft)", borderRadius: 6, flexWrap: "wrap" }}>
            <span>{r.settled_on}</span>
            <span style={{ flex: 1, minWidth: 160 }}>
              {formatINR(Number(r.net_inr))}
              {Number(r.fees_inr) + Number(r.tax_inr) > 0 && (
                <strong style={{ color: "#b45309" }}> · fee {formatINR(Number(r.fees_inr) + Number(r.tax_inr))} — needs booking separately</strong>
              )}
            </span>
            <span className="muted">UTR {r.utr || "—"}</span>
          </div>
        ))}
      </div>
    </details>
  )}

  {(sPosted.length > 0 || sMatched.length > 0) && (
    <details style={{ marginTop: 10 }}>
      <summary className="btn small secondary as-btn">📗 Done ({sPosted.length + sMatched.length})</summary>
      <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
        {[...sPosted, ...sMatched].map((r) => (
          <div key={r.id} style={{ display: "flex", gap: 10, fontSize: ".82rem", padding: "4px 10px", background: "var(--bg-soft)", borderRadius: 6, flexWrap: "wrap" }}>
            <span>{r.status === "posted" ? "✅" : "🤝"} {r.settled_on}</span>
            <span style={{ flex: 1, minWidth: 160 }}>net {formatINR(Number(r.net_inr))} · gross {formatINR(Number(r.gross_inr))}</span>
            <span className="muted">UTR {r.utr || "—"}</span>
          </div>
        ))}
      </div>
    </details>
  )}
    </DeskShell>
  );
}
