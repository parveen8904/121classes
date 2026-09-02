import { assertArea } from "@/lib/adminAccess";
import { zohoConfigured } from "@/lib/zohoApi";
import { backlogItems } from "@/lib/zohoDesk";
import SubmitButton from "@/app/components/SubmitButton";
import DeskShell from "../_shell";

// THE BACKLOG — everything still to be done, as at a chosen date.

export const dynamic = "force-dynamic";

export default async function BacklogPage(props: { searchParams: Promise<{ scan?: string; upto?: string }> }) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const hubConnected = await zohoConfigured();
  const todayIST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const upto = sp.upto && /^\d{4}-\d{2}-\d{2}$/.test(sp.upto) ? sp.upto : todayIST;
  let backlog: Awaited<ReturnType<typeof backlogItems>> = { items: [], neverUploaded: [] };
  if (hubConnected) { try { backlog = await backlogItems(upto); } catch { /* the page degrades to empty */ } }

  return (
    <DeskShell
      badge="📋 Task list"
      title="The backlog"
      subtitle="What is still waiting, as at whichever date you choose."
      current="/admin/zoho/backlog"
      message={sp.scan}
    >

  <form style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
    <strong>📋 Task list — what is pending till</strong>
    <input type="date" name="upto" defaultValue={upto} style={{ marginBottom: 0 }} />
    <SubmitButton className="btn small secondary" savedLabel="✓">Show backlog</SubmitButton>
    <span className="muted" style={{ fontSize: ".78rem" }}>Change the date and the backlog recomputes.</span>
  </form>
  {backlog.items.length === 0 ? (
    <p className="muted" style={{ margin: "10px 0 0", fontSize: ".88rem" }}>✅ Nothing pending up to {upto} — statements covered and every queue clear.</p>
  ) : (
    <div style={{ display: "grid", gap: 5, marginTop: 10 }}>
      {backlog.items.map((b, i) => (
        <a key={i} href={b.anchor} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 10px", background: "var(--bg-soft)", borderRadius: 8, color: "var(--text)", textDecoration: "none" }}>
          <span className="badge" style={{ fontSize: ".7rem", minWidth: 110, textAlign: "center" }}>{b.part}</span>
          <span style={{ flex: 1, fontSize: ".86rem" }}>{b.task}</span>
          {b.count !== undefined && <strong>{b.count}</strong>}
          <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".8rem" }}>open →</span>
        </a>
      ))}
    </div>
  )}
  {backlog.neverUploaded.length > 0 && (
    <details style={{ marginTop: 8 }}>
      <summary className="muted" style={{ cursor: "pointer", fontSize: ".8rem" }}>
        {backlog.neverUploaded.length} account(s) with no statement uploaded yet
      </summary>
      <p className="muted" style={{ fontSize: ".78rem", margin: "6px 0 0" }}>{backlog.neverUploaded.join(" · ")}</p>
    </details>
  )}
    </DeskShell>
  );
}
