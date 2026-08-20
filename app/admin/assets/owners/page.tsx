import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../../_components/AdminHero";
import { assetViewer, dmy, inr } from "@/lib/assets";

export const dynamic = "force-dynamic";
export const metadata = { title: "Owner statements — Admin" };

// WHOSE MONEY IS WHERE. Founder only — this is the one page that joins
// ownership percentages to the ledger: each owner's share of every rupee in
// and out, per asset and in total, for a chosen period. Verified transactions
// only, because a statement built on unchecked entries is a rumour.

export default async function OwnerStatementsPage(props: {
  searchParams: Promise<{ owner?: string; from?: string; to?: string }>;
}) {
  const v = await assetViewer();
  if (!v || v.role !== "admin") redirect("/admin/assets");
  const sp = await props.searchParams;
  const svc = createServiceClient();

  const year = new Date().getFullYear();
  const fyStart = new Date().getMonth() >= 3 ? `${year}-04-01` : `${year - 1}-04-01`;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : fyStart;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : new Date().toISOString().slice(0, 10);

  const [{ data: owners }, { data: txns }, { data: assets }] = await Promise.all([
    svc.from("asset_owners").select("asset_id, owner_name, share_pct"),
    svc.from("asset_txns").select("asset_id, on_date, direction, amount, gst, tds")
      .not("verified_at", "is", null).gte("on_date", from).lte("on_date", to).limit(5000),
    svc.from("assets").select("id, name"),
  ]);

  const names = [...new Set((owners ?? []).map((o) => String(o.owner_name)))].sort();
  const owner = sp.owner && names.includes(sp.owner) ? sp.owner : names[0];
  const assetName = new Map((assets ?? []).map((a) => [String(a.id), String(a.name)]));

  const myShares = new Map<string, number>();
  for (const o of owners ?? []) {
    if (String(o.owner_name) === owner) myShares.set(String(o.asset_id), Number(o.share_pct) / 100);
  }

  const perAsset = new Map<string, { income: number; expense: number; tds: number }>();
  for (const t of txns ?? []) {
    const share = myShares.get(String(t.asset_id));
    if (!share) continue;
    const row = perAsset.get(String(t.asset_id)) ?? { income: 0, expense: 0, tds: 0 };
    if (t.direction === "out") row.expense += Number(t.amount) * share;
    else row.income += Number(t.amount) * share;
    row.tds += Number(t.tds ?? 0) * share;
    perAsset.set(String(t.asset_id), row);
  }
  const rows = [...perAsset.entries()].sort((a, b) => (b[1].income - b[1].expense) - (a[1].income - a[1].expense));
  const total = rows.reduce((s, [, r]) => ({ income: s.income + r.income, expense: s.expense + r.expense, tds: s.tds + r.tds }), { income: 0, expense: 0, tds: 0 });

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="👥 Owner statements"
        title="Whose money is where"
        subtitle="Each owner's share of every verified rupee, split by their ownership percentage. Unverified entries are excluded on purpose."
        back={{ href: "/admin/assets", label: "Assets" }}
      />

      <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", margin: "14px 0" }}>
        <div>
          <label>Owner</label>
          <select name="owner" defaultValue={owner}>{names.map((n) => <option key={n}>{n}</option>)}</select>
        </div>
        <div><label>From</label><input type="date" name="from" defaultValue={from} /></div>
        <div><label>To</label><input type="date" name="to" defaultValue={to} /></div>
        <button className="btn small" type="submit">Show</button>
      </form>

      {names.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>No owners recorded yet — add them on each asset&apos;s page.</p></div>
      ) : (
        <>
          <div className="card" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div><div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--accent)" }}>{inr(total.income)}</div><div className="muted" style={{ fontSize: ".8rem" }}>share of income</div></div>
            <div><div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#b91c1c" }}>{inr(total.expense)}</div><div className="muted" style={{ fontSize: ".8rem" }}>share of expenses</div></div>
            <div><div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{inr(total.income - total.expense)}</div><div className="muted" style={{ fontSize: ".8rem" }}>net for {owner}</div></div>
            <div><div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{inr(total.tds)}</div><div className="muted" style={{ fontSize: ".8rem" }}>TDS in their name</div></div>
          </div>

          <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
            {rows.map(([assetId, r]) => (
              <div className="list-row" key={assetId}>
                <span className="row-title"><Link href={`/admin/assets/${assetId}`}>{assetName.get(assetId) ?? "asset"}</Link>
                  <span className="muted" style={{ fontSize: ".78rem" }}> · {Math.round((myShares.get(assetId) ?? 0) * 100)}% share</span>
                </span>
                <span>
                  +{inr(r.income)} <span style={{ color: "#b91c1c" }}>−{inr(r.expense)}</span> = <strong>{inr(r.income - r.expense)}</strong>
                </span>
              </div>
            ))}
            {rows.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>No verified transactions for {owner} between {dmy(from)} and {dmy(to)}.</p></div>}
          </div>
        </>
      )}
    </section>
  );
}
