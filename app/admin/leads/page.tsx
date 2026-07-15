import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import DeleteButton from "../_components/DeleteButton";
import SubmitButton from "@/app/components/SubmitButton";
import { importLeads, deleteLead, addLeadManual } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads — Admin" };

const SOURCE_LABEL: Record<string, string> = {
  csv: "📄 CSV import", interakt: "💬 Interakt export", whatsapp: "💬 WhatsApp",
  youtube: "▶️ YouTube", landing: "🪄 Free-planner page", manual: "✍️ Manual", other: "Other",
};

export default async function LeadsPage({ searchParams }: { searchParams: { msg?: string; added?: string; students?: string; dupes?: string } }) {
  const svc = createServiceClient();
  const [{ data: leads }, { count: total }, { count: matched }] = await Promise.all([
    svc.from("leads").select("id, name, phone, email, source, note, matched_user_id, created_at").order("created_at", { ascending: false }).limit(200),
    svc.from("leads").select("id", { count: "exact", head: true }),
    svc.from("leads").select("id", { count: "exact", head: true }).not("matched_user_id", "is", null),
  ]);

  const m = searchParams.msg;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="📇 Leads"
        title="Contacts & leads"
        subtitle="Import contacts from Interakt/WhatsApp exports or your call lists. Leads join the WhatsApp campaign audience, and the phone system recognises them when they call. 📞"
        back={{ href: "/admin", label: "Admin" }}
      />

      {m === "done" && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✅ Imported <strong>{searchParams.added}</strong> new contact{searchParams.added === "1" ? "" : "s"}
          {Number(searchParams.students) > 0 && <> — {searchParams.students} of them are already students (linked, not duplicated)</>}
          {Number(searchParams.dupes) > 0 && <> · {searchParams.dupes} skipped (already in the list)</>}.
        </div>
      )}
      {m === "empty" && <div className="notice err" style={{ marginTop: 16 }}>Choose a CSV file or paste some contacts first.</div>}
      {m === "none" && <div className="notice err" style={{ marginTop: 16 }}>Couldn&apos;t find any phone numbers or emails in that file. Each line needs at least a 10-digit mobile or an email.</div>}
      {m === "exists" && <div className="notice err" style={{ marginTop: 16 }}>That contact is already in the leads list.</div>}
      {m === "added1" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Lead added.</div>}
      {m === "nocontact" && <div className="notice err" style={{ marginTop: 16 }}>Enter at least a phone number or an email.</div>}

      {/* Stats */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
        <div className="card" style={{ padding: "10px 16px" }}><strong>{total ?? 0}</strong> <span className="muted">leads</span></div>
        <div className="card" style={{ padding: "10px 16px" }}><strong>{matched ?? 0}</strong> <span className="muted">already students</span></div>
        <div className="card" style={{ padding: "10px 16px" }}><strong>{(total ?? 0) - (matched ?? 0)}</strong> <span className="muted">new prospects</span></div>
      </div>

      {/* Import */}
      <div className="form-card" style={{ marginTop: 18 }}>
        <h3>📥 Import contacts (CSV or paste)</h3>
        <p className="muted" style={{ fontSize: ".84rem", marginTop: 0 }}>
          Works with the contact export from <strong>Interakt</strong> (Contacts → Export) and any other CSV —
          column order doesn&apos;t matter, we find the phone/email on each line automatically. Duplicates and
          existing students are detected, never double-added.
        </p>
        <form action={importLeads}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>CSV file</label>
              <input type="file" name="csv" accept=".csv,.txt,text/csv,text/plain" />
            </div>
            <div>
              <label>Where are these contacts from?</label>
              <select name="source" defaultValue="interakt">
                <option value="interakt">Interakt (WhatsApp) export</option>
                <option value="whatsapp">WhatsApp (collected manually)</option>
                <option value="youtube">YouTube</option>
                <option value="csv">Other CSV</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <label style={{ marginTop: 8 }}>…or paste contacts (one per line — name, phone, email in any order)</label>
          <textarea name="pasted" rows={4} placeholder={"Rahul Verma, 9812345678\nPriya S, priya@gmail.com, 9876543210"} />
          <SubmitButton className="btn" savedLabel="✓ Imported" style={{ marginTop: 10 }}>Import contacts</SubmitButton>
        </form>
      </div>

      {/* Add one */}
      <details className="card" style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>✍️ Add one lead by hand</summary>
        <form action={addLeadManual} style={{ marginTop: 10 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
            <div><label>Name</label><input name="name" /></div>
            <div><label>Phone</label><input name="phone" placeholder="10-digit" /></div>
            <div><label>Email</label><input name="email" type="email" /></div>
          </div>
          <label style={{ marginTop: 6 }}>Note (optional)</label>
          <input name="note" placeholder="e.g. asked about CA Final FR on a call" />
          <SubmitButton className="btn small" savedLabel="✓ Added" style={{ marginTop: 8 }}>Add lead</SubmitButton>
        </form>
      </details>

      {/* List */}
      <h2 className="admin-section-title" style={{ marginTop: 24 }}>📇 Latest leads {total && total > 200 ? `(showing 200 of ${total})` : ""}</h2>
      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        {(leads ?? []).length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>📭 No leads yet — import your first list above.</p></div>}
        {(leads ?? []).map((l) => (
          <div className="list-row" key={l.id}>
            <div>
              <span className="row-title">{l.name || l.phone || l.email}</span>
              <p className="row-sub">
                {l.phone ? `📞 ${l.phone}` : ""}{l.phone && l.email ? " · " : ""}{l.email ? `✉️ ${l.email}` : ""}
                {" · "}{SOURCE_LABEL[l.source] ?? l.source}
                {l.matched_user_id ? " · 🎓 already a student" : ""}
                {l.note ? ` · ${l.note}` : ""}
                {` · ${new Date(l.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
              </p>
            </div>
            <DeleteButton action={deleteLead} id={l.id} message="Remove this lead?" />
          </div>
        ))}
      </div>
    </section>
  );
}
