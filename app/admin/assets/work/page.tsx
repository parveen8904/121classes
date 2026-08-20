import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { assetViewer, dmy, inr, istToday } from "@/lib/assets";
import { addTxn, closeLetter } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "My asset work — Admin" };

// THE HANDLER'S DAY: what is due, what is late, what letter waits — and the
// form to finish each right here. Completing a task and recording its money
// are ONE act; that was the founder's design and it is the whole point of
// this screen.

export default async function AssetWorkPage() {
  const v = await assetViewer();
  if (!v) redirect("/admin");
  const svc = createServiceClient();
  const today = istToday();
  const mine = v.role === "handler";

  let occQ = svc
    .from("asset_occurrences")
    .select("id, due_on, status, task_id, asset_id, asset_tasks!inner(title, nature, direction, expected_amount, assigned_to), assets!inner(name, status)")
    .eq("status", "pending")
    .order("due_on")
    .limit(200);
  if (mine) occQ = occQ.eq("asset_tasks.assigned_to", v.staff.id);
  let letQ = svc
    .from("asset_letters")
    .select("id, asset_id, title, due_on, action_plan, assets!inner(name)")
    .eq("status", "open")
    .order("due_on", { ascending: true })
    .limit(100);
  if (mine) letQ = letQ.eq("assigned_to", v.staff.id);

  const [{ data: occs }, { data: letters }] = await Promise.all([occQ, letQ]);
  type Occ = NonNullable<typeof occs>[number];
  const rows = (occs ?? []).filter((o) => (o.assets as unknown as { status?: string } | null)?.status !== "closed");
  const overdue = rows.filter((o) => String(o.due_on) < today);
  const dueSoon = rows.filter((o) => String(o.due_on) >= today);

  const OccCard = ({ o, late }: { o: Occ; late: boolean }) => {
    const t = o.asset_tasks as unknown as { title: string; nature: string; direction: string; expected_amount: number | null };
    const asset = (o.assets as unknown as { name: string }).name;
    return (
      <div className="card" key={String(o.id)} style={{ borderLeft: late ? "4px solid #b45309" : undefined }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
          <strong>{t.title}</strong>
          <Link href={`/admin/assets/${o.asset_id}`} style={{ fontSize: ".84rem" }}>{asset}</Link>
          <span className="muted" style={{ fontSize: ".8rem" }}>due {dmy(String(o.due_on))}{t.expected_amount != null ? ` · expected ${inr(t.expected_amount)}` : ""}</span>
          {late && <span style={{ color: "#b45309", fontWeight: 700, fontSize: ".8rem" }}>OVERDUE</span>}
        </div>
        <details style={{ marginTop: 6 }}>
          <summary className="btn small secondary as-btn" style={{ display: "inline-block" }}>✓ Done — record the money</summary>
          <form action={addTxn} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8, marginTop: 8 }}>
            <input type="hidden" name="asset_id" value={String(o.asset_id)} />
            <input type="hidden" name="occurrence_id" value={String(o.id)} />
            <input type="hidden" name="nature" value={t.nature} />
            <input type="hidden" name="direction" value={t.direction} />
            <input type="hidden" name="back" value="/admin/assets/work" />
            <div><label>Date</label><input type="date" name="on_date" defaultValue={today} required /></div>
            <div><label>Amount (₹)</label><input name="amount" inputMode="numeric" defaultValue={t.expected_amount != null ? String(t.expected_amount) : ""} required /></div>
            <div><label>GST (₹)</label><input name="gst" inputMode="numeric" placeholder="0" /></div>
            <div><label>TDS (₹)</label><input name="tds" inputMode="numeric" placeholder="0" /></div>
            <div><label>Proof</label><input type="file" name="file" /></div>
            <div><label>Note</label><input name="note" /></div>
            <SubmitButton className="btn small">Record — accounts will verify</SubmitButton>
          </form>
        </details>
      </div>
    );
  };

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="📋 My asset work"
        title={mine ? "Your due and overdue work" : "All due and overdue work"}
        subtitle="Finishing a task and recording its money are one form. Anything overdue sits on top in amber."
        back={{ href: "/admin/assets", label: "Assets" }}
      />

      {overdue.length > 0 && <h2 className="admin-section-title">⌛ Overdue ({overdue.length})</h2>}
      <div style={{ display: "grid", gap: 8 }}>{overdue.map((o) => <OccCard key={String(o.id)} o={o} late />)}</div>

      <h2 className="admin-section-title">🗓️ Coming up ({dueSoon.length})</h2>
      <div style={{ display: "grid", gap: 8 }}>
        {dueSoon.map((o) => <OccCard key={String(o.id)} o={o} late={false} />)}
        {dueSoon.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing pending. 🎉</p></div>}
      </div>

      <h2 className="admin-section-title">📬 Open letters ({(letters ?? []).length})</h2>
      <div style={{ display: "grid", gap: 8 }}>
        {(letters ?? []).map((l) => (
          <div className="card" key={String(l.id)} style={{ borderLeft: l.due_on && String(l.due_on) < today ? "4px solid #b45309" : undefined }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <strong>{String(l.title)}</strong>
              <Link href={`/admin/assets/${l.asset_id}`} style={{ fontSize: ".84rem" }}>{(l.assets as unknown as { name: string }).name}</Link>
              {l.due_on && <span className="muted" style={{ fontSize: ".8rem" }}>act by {dmy(String(l.due_on))}</span>}
            </div>
            {l.action_plan && <p style={{ fontSize: ".86rem", margin: "6px 0 0" }}>{String(l.action_plan)}</p>}
            <form action={closeLetter} style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "end", flexWrap: "wrap" }}>
              <input type="hidden" name="id" value={String(l.id)} />
              <input type="hidden" name="asset_id" value={String(l.asset_id)} />
              <input type="hidden" name="back" value="/admin/assets/work" />
              <div style={{ flex: 1, minWidth: 200 }}><label style={{ fontSize: ".76rem" }}>What was done</label><input name="closed_note" /></div>
              <SubmitButton className="btn small secondary">Close it</SubmitButton>
            </form>
          </div>
        ))}
        {(letters ?? []).length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>No open letters.</p></div>}
      </div>
    </section>
  );
}
