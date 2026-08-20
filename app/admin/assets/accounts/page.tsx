import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { assetViewer, dmy, inr, istToday, signAssetPath } from "@/lib/assets";
import { queryTxn, verifyTxn } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assets — accounts desk" };

// THE ACCOUNTS DESK: every unverified rupee, and every silence that should
// have been money — overdue tasks, short-paid rent, letters nobody answered,
// agreements about to lapse. Verification is maker-checker, exactly as on the
// vendor orders desk: the handler records, accounts ticks or asks.

export default async function AssetsAccountsPage() {
  const v = await assetViewer();
  if (!v || (v.role !== "admin" && v.role !== "accounts")) redirect("/admin/assets");
  const svc = createServiceClient();
  const today = istToday();
  const in60 = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);

  const [{ data: unverified }, { data: overdue }, { data: shorts }, { data: lateLetters }, { data: expiring }] = await Promise.all([
    svc.from("asset_txns")
      .select("id, asset_id, on_date, nature, direction, amount, gst, tds, doc_path, note, accounts_query, assets!inner(name)")
      .is("verified_at", null).order("on_date").limit(200),
    svc.from("asset_occurrences")
      .select("id, due_on, asset_id, asset_tasks!inner(title, expected_amount, assigned_to), assets!inner(name, status)")
      .eq("status", "pending").lt("due_on", today).order("due_on").limit(200),
    // Done occurrences whose money fell short of what the tenancy/task expects.
    svc.from("asset_occurrences")
      .select("id, due_on, asset_id, txn_id, asset_tasks!inner(title, expected_amount), assets!inner(name)")
      .eq("status", "done").not("txn_id", "is", null)
      .gte("due_on", new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10))
      .limit(300),
    svc.from("asset_letters")
      .select("id, asset_id, title, due_on, assets!inner(name)")
      .eq("status", "open").lt("due_on", today).limit(100),
    svc.from("asset_tenancy")
      .select("asset_id, tenant_name, agreement_expiry, assets!inner(name, status)")
      .not("agreement_expiry", "is", null).lte("agreement_expiry", in60).limit(100),
  ]);

  // Resolve short payments: compare the completing transaction to expectation.
  const txnIds = (shorts ?? []).map((s) => String(s.txn_id)).filter(Boolean);
  const txnAmounts = new Map<string, number>();
  if (txnIds.length) {
    const { data: st } = await svc.from("asset_txns").select("id, amount").in("id", txnIds);
    for (const t of st ?? []) txnAmounts.set(String(t.id), Number(t.amount));
  }
  const shortRows = (shorts ?? []).filter((s) => {
    const exp = Number((s.asset_tasks as unknown as { expected_amount: number | null }).expected_amount ?? 0);
    const got = txnAmounts.get(String(s.txn_id)) ?? 0;
    return exp > 0 && got > 0 && got < exp;
  });

  const liveOverdue = (overdue ?? []).filter((o) => (o.assets as unknown as { status?: string }).status !== "closed");
  const liveExpiring = (expiring ?? []).filter((e) => (e.assets as unknown as { status?: string }).status !== "closed");

  const signed = new Map<string, string>();
  await Promise.all((unverified ?? []).filter((t) => t.doc_path).map(async (t) => {
    const u = await signAssetPath(String(t.doc_path));
    if (u) signed.set(String(t.doc_path), u);
  }));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 950 }}>
      <AdminHero
        badge="🧾 Assets — accounts"
        title="Verify the money, chase the silence"
        subtitle="Every transaction lands here unverified. Below it, the pendency: overdue tasks, short-paid rent, unanswered letters, agreements about to lapse."
        back={{ href: "/admin/assets", label: "Assets" }}
      />

      <h2 className="admin-section-title">⏳ To verify ({(unverified ?? []).length})</h2>
      <div style={{ display: "grid", gap: 8 }}>
        {(unverified ?? []).map((t) => (
          <div className="card" key={String(t.id)}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <strong>{t.direction === "out" ? "−" : "+"}{inr(t.amount as number)}</strong>
              <span>{String(t.nature)}</span>
              <Link href={`/admin/assets/${t.asset_id}`} style={{ fontSize: ".84rem" }}>{(t.assets as unknown as { name: string }).name}</Link>
              <span className="muted" style={{ fontSize: ".8rem" }}>
                {dmy(String(t.on_date))}
                {Number(t.gst) ? ` · GST ${inr(t.gst as number)}` : ""}{Number(t.tds) ? ` · TDS ${inr(t.tds as number)}` : ""}
              </span>
              {t.doc_path ? <a href={signed.get(String(t.doc_path))} target="_blank" rel="noreferrer">📎 proof</a> : <span style={{ color: "#b45309", fontSize: ".8rem", fontWeight: 700 }}>no proof attached</span>}
            </div>
            {t.note && <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 0" }}>{String(t.note)}</p>}
            {t.accounts_query && <p style={{ color: "#b45309", fontSize: ".82rem", margin: "4px 0 0", fontWeight: 700 }}>❓ queried: {String(t.accounts_query)}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "end" }}>
              <form action={verifyTxn}>
                <input type="hidden" name="id" value={String(t.id)} />
                <SubmitButton className="btn small" savedLabel="✓">✓ Verified — date, amount, GST/TDS checked</SubmitButton>
              </form>
              <form action={queryTxn} style={{ display: "flex", gap: 8, alignItems: "end" }}>
                <input type="hidden" name="id" value={String(t.id)} />
                <div><label style={{ fontSize: ".76rem" }}>Or raise a query</label><input name="query" placeholder="TDS looks wrong — recheck" /></div>
                <SubmitButton className="btn small secondary">Ask</SubmitButton>
              </form>
            </div>
          </div>
        ))}
        {(unverified ?? []).length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Everything verified. 🎉</p></div>}
      </div>

      <h2 className="admin-section-title">⌛ Overdue tasks ({liveOverdue.length})</h2>
      <div style={{ display: "grid", gap: 6 }}>
        {liveOverdue.map((o) => (
          <div className="list-row" key={String(o.id)}>
            <span className="row-title">
              {(o.asset_tasks as unknown as { title: string }).title} — <Link href={`/admin/assets/${o.asset_id}`}>{(o.assets as unknown as { name: string }).name}</Link>
            </span>
            <span style={{ color: "#b45309", fontWeight: 700 }}>due {dmy(String(o.due_on))}</span>
          </div>
        ))}
        {liveOverdue.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing overdue.</p></div>}
      </div>

      {shortRows.length > 0 && (
        <>
          <h2 className="admin-section-title">📉 Short payments (last 90 days)</h2>
          <div style={{ display: "grid", gap: 6 }}>
            {shortRows.map((s) => {
              const exp = Number((s.asset_tasks as unknown as { expected_amount: number }).expected_amount);
              const got = txnAmounts.get(String(s.txn_id)) ?? 0;
              return (
                <div className="list-row" key={String(s.id)}>
                  <span className="row-title">
                    {(s.asset_tasks as unknown as { title: string }).title} · {dmy(String(s.due_on))} — <Link href={`/admin/assets/${s.asset_id}`}>{(s.assets as unknown as { name: string }).name}</Link>
                  </span>
                  <span style={{ color: "#b45309", fontWeight: 700 }}>{inr(got)} against {inr(exp)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {(lateLetters ?? []).length > 0 && (
        <>
          <h2 className="admin-section-title">📬 Letters past their date ({(lateLetters ?? []).length})</h2>
          <div style={{ display: "grid", gap: 6 }}>
            {(lateLetters ?? []).map((l) => (
              <div className="list-row" key={String(l.id)}>
                <span className="row-title">{String(l.title)} — <Link href={`/admin/assets/${l.asset_id}`}>{(l.assets as unknown as { name: string }).name}</Link></span>
                <span style={{ color: "#b45309", fontWeight: 700 }}>was due {dmy(String(l.due_on))}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {liveExpiring.length > 0 && (
        <>
          <h2 className="admin-section-title">📜 Agreements expiring within 60 days</h2>
          <div style={{ display: "grid", gap: 6 }}>
            {liveExpiring.map((e) => (
              <div className="list-row" key={String(e.asset_id)}>
                <span className="row-title">
                  {String(e.tenant_name ?? "tenant")} — <Link href={`/admin/assets/${e.asset_id}`}>{(e.assets as unknown as { name: string }).name}</Link>
                </span>
                <span style={{ color: "#b45309", fontWeight: 700 }}>expires {dmy(String(e.agreement_expiry))}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
