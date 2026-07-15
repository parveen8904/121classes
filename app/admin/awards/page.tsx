import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import DeleteButton from "../_components/DeleteButton";
import { createServiceClient } from "@/lib/supabase/service";
import { viaProxy } from "@/lib/fileProxy";
import { setAwardStatus, deleteAward } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Result awards — Admin" };

type Row = { id: string; name: string; phone: string; email: string | null; achievement: string; marks: string | null; photo_url: string | null; marksheet_url: string | null; message: string | null; status: string; created_at: string };

export default async function AwardsAdmin() {
  const svc = createServiceClient();
  const { data } = await svc.from("award_submissions").select("*").order("created_at", { ascending: false }).limit(300);
  const rows = (data ?? []) as Row[];
  const pending = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status !== "pending");

  const Card = ({ r }: { r: Row }) => (
    <div className="card" style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <strong>🏆 {r.name} — {r.achievement}</strong>
        <span className="muted" style={{ fontSize: ".8rem" }}>{new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
      </div>
      <div className="muted" style={{ fontSize: ".85rem" }}>
        📞 {r.phone}{r.email ? ` · ✉️ ${r.email}` : ""}{r.marks ? ` · 📊 ${r.marks}` : ""}
        {r.status === "approved" ? " · ✅ approved" : r.status === "rejected" ? " · ❌ rejected" : ""}
      </div>
      {r.message && <p style={{ fontSize: ".88rem", margin: 0 }}>{r.message}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {r.photo_url && <a className="btn small secondary" href={viaProxy(r.photo_url)} target="_blank" rel="noopener noreferrer">📷 Photo</a>}
        {r.marksheet_url && <a className="btn small secondary" href={viaProxy(r.marksheet_url)} target="_blank" rel="noopener noreferrer">📄 Marksheet</a>}
        {r.status !== "approved" && (
          <form action={setAwardStatus} style={{ margin: 0 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="approved" /><SubmitButton className="btn small">Approve</SubmitButton></form>
        )}
        {r.status !== "rejected" && (
          <form action={setAwardStatus} style={{ margin: 0 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="rejected" /><SubmitButton className="btn small secondary">Reject</SubmitButton></form>
        )}
        <DeleteButton action={deleteAward} id={r.id} message="Delete this submission?" />
      </div>
    </div>
  );

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
      <AdminHero badge="🏆 Result awards" title="Students who shared their result" subtitle="Verify the marksheet, then approve to celebrate them (and add a public result photo on the Results page)." back={{ href: "/admin", label: "Admin" }} />
      <h2 className="admin-section-title">🕐 To review ({pending.length})</h2>
      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        {pending.length === 0 ? <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing to review.</p></div> : pending.map((r) => <Card key={r.id} r={r} />)}
      </div>
      {done.length > 0 && (
        <>
          <h2 className="admin-section-title" style={{ marginTop: 24 }}>Reviewed ({done.length})</h2>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>{done.map((r) => <Card key={r.id} r={r} />)}</div>
        </>
      )}
    </section>
  );
}
