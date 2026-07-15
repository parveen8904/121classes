import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase/service";
import { viaProxy } from "@/lib/fileProxy";
import { decideScholarship } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scholarships — Admin" };

type Row = { id: string; kind: string; marks_percent: number | null; marksheet_date: string | null; marksheet_url: string | null; reason: string | null; status: string; discount_percent: number | null; coupon_code: string | null; created_at: string; student_id: string };

export default async function ScholarshipsAdmin() {
  const svc = createServiceClient();
  const { data } = await svc.from("scholarship_applications").select("*").order("created_at", { ascending: false }).limit(300);
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.map((r) => r.student_id))];
  const names = new Map<string, { name: string | null; email: string | null }>();
  if (ids.length) {
    const { data: profs } = await svc.from("profiles").select("id, full_name, email").in("id", ids);
    for (const p of profs ?? []) names.set(p.id as string, { name: p.full_name as string, email: p.email as string });
  }
  const pending = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status !== "pending");

  const Card = ({ r }: { r: Row }) => {
    const who = names.get(r.student_id);
    const merit = r.kind === "merit";
    const oneYearOld = r.marksheet_date && new Date(r.marksheet_date) < new Date(Date.now() - 365 * 864e5);
    return (
      <div className="card" style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <strong>{merit ? "🎯 Merit (15%)" : "🤲 Need-based (10%)"} — {who?.name || "Student"}</strong>
          <span className="muted" style={{ fontSize: ".8rem" }}>{new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
        </div>
        <div className="muted" style={{ fontSize: ".85rem" }}>
          {who?.email}
          {merit && <> · 📊 <strong>{r.marks_percent}%</strong> · dated {r.marksheet_date}{oneYearOld ? " ⚠️ older than 1 year" : ""}{r.marks_percent != null && r.marks_percent < 55 ? " ⚠️ below 55%" : ""}</>}
          {r.status === "approved" && <> · ✅ approved · coupon <strong>{r.coupon_code}</strong></>}
          {r.status === "rejected" && <> · ❌ rejected</>}
        </div>
        {!merit && r.reason && <p style={{ fontSize: ".88rem", margin: 0 }}>{r.reason}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {r.marksheet_url && <a className="btn small secondary" href={viaProxy(r.marksheet_url)} target="_blank" rel="noopener noreferrer">📄 Marksheet</a>}
          {r.status === "pending" && (
            <>
              <form action={decideScholarship} style={{ margin: 0 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /><SubmitButton className="btn small">Approve &amp; email coupon</SubmitButton></form>
              <form action={decideScholarship} style={{ margin: 0 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" /><SubmitButton className="btn small secondary">Reject</SubmitButton></form>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
      <AdminHero badge="💚 Scholarships" title="Financial-help applications" subtitle="Verify the marksheet (merit: ≤1yr & ≥55% → 15%) or the need statement (→10%). Approve to auto-issue & email a coupon." back={{ href: "/admin", label: "Admin" }} />
      <h2 className="admin-section-title">🕐 To review ({pending.length})</h2>
      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        {pending.length === 0 ? <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing to review.</p></div> : pending.map((r) => <Card key={r.id} r={r} />)}
      </div>
      {done.length > 0 && (
        <>
          <h2 className="admin-section-title" style={{ marginTop: 24 }}>Decided ({done.length})</h2>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>{done.map((r) => <Card key={r.id} r={r} />)}</div>
        </>
      )}
    </section>
  );
}
