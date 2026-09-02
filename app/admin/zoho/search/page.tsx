import { assertArea } from "@/lib/adminAccess";
import { zohoConfigured } from "@/lib/zohoApi";
import { formatINR } from "@/lib/pricing";
import { searchDesk } from "@/lib/zohoDesk";
import SubmitButton from "@/app/components/SubmitButton";
import DeskShell from "../_shell";

// SEARCH EVERYTHING — one query across every queue on the desk.

export const dynamic = "force-dynamic";

export default async function SearchPage(props: {
  searchParams: Promise<{ scan?: string; q?: string; from?: string; to?: string; part?: string }>;
}) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const hubConnected = await zohoConfigured();
  const searching = Boolean((sp.q ?? "").trim() || sp.from || sp.to || (sp.part && sp.part !== "all"));
  let searchRows: Awaited<ReturnType<typeof searchDesk>> = [];
  if (hubConnected && searching) {
    try { searchRows = await searchDesk({ q: sp.q, from: sp.from, to: sp.to, part: sp.part }); } catch { /* empty */ }
  }

  return (
    <DeskShell
      badge="🔎 Search"
      title="Search everything"
      subtitle="One query across sales, statements, petty cash, investments and invoices."
      current="/admin/zoho/search"
      message={sp.scan}
    >

  <form style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
    <div style={{ flex: 1, minWidth: 200 }}>
      <label style={{ fontSize: ".72rem" }}>🔎 Search everything</label>
      <input name="q" defaultValue={sp.q ?? ""} placeholder="narration, customer, UTR, symbol, order no…" style={{ marginBottom: 0 }} />
    </div>
    <div>
      <label style={{ fontSize: ".72rem" }}>From</label>
      <input type="date" name="from" defaultValue={sp.from ?? ""} style={{ marginBottom: 0 }} />
    </div>
    <div>
      <label style={{ fontSize: ".72rem" }}>To</label>
      <input type="date" name="to" defaultValue={sp.to ?? ""} style={{ marginBottom: 0 }} />
    </div>
    <div>
      <label style={{ fontSize: ".72rem" }}>Part</label>
      <select name="part" defaultValue={sp.part ?? "all"} style={{ marginBottom: 0 }}>
        <option value="all">Everything</option>
        <option value="sales">Sales</option>
        <option value="settlements">Settlements</option>
        <option value="bank">Bank lines</option>
        <option value="brokerage">Brokerage</option>
        <option value="petty">Petty cash</option>
      </select>
    </div>
    <SubmitButton className="btn small" savedLabel="✓">Search</SubmitButton>
    {searching && <a className="btn small secondary" href="/admin/zoho/search">Clear</a>}
  </form>
  {searching && (
    <div style={{ marginTop: 10 }}>
      <p className="muted" style={{ fontSize: ".8rem", margin: "0 0 6px" }}>{searchRows.length} result(s){searchRows.length === 300 ? " (first 300)" : ""} — every status included, for reconciliation.</p>
      <div style={{ display: "grid", gap: 4 }}>
        {searchRows.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "5px 10px", background: "var(--bg-soft)", borderRadius: 6, fontSize: ".82rem" }}>
            <span style={{ whiteSpace: "nowrap" }}>{r.date}</span>
            <span className="badge" style={{ fontSize: ".68rem" }}>{r.part}</span>
            <span style={{ flex: 1, minWidth: 200 }}>{r.label}</span>
            {r.amount !== null && <strong style={{ whiteSpace: "nowrap" }}>{r.amount < 0 ? `− ${formatINR(Math.abs(r.amount))}` : formatINR(r.amount)}</strong>}
            <span className="muted" style={{ fontSize: ".74rem" }}>{r.status}{r.ref ? ` · ${r.ref}` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  )}
    </DeskShell>
  );
}
