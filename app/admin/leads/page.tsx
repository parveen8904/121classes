import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import DeleteButton from "../_components/DeleteButton";
import SubmitButton from "@/app/components/SubmitButton";
import { importLeads, deleteLead, addLeadManual } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads — Admin" };

const SOURCE_LABEL: Record<string, string> = {
  csv: "📄 CSV import", interakt: "💬 Interakt export", whatsapp: "💬 WhatsApp",
  youtube: "▶️ YouTube", landing: "🪄 Free-planner page", manual: "✍️ Manual",
  meta: "💰 Meta/Instagram ad", google: "💰 Google ad", popup: "🧩 Site popup", phone: "📞 Phone call", other: "Other",
};

export default async function LeadsPage(
  props: { searchParams: Promise<{ msg?: string; added?: string; students?: string; dupes?: string; level?: string }> }
) {
  const searchParams = await props.searchParams;
  const svc = createServiceClient();
  const [{ data: leads }, { count: total }, { count: matched }] = await Promise.all([
    svc.from("leads").select("id, name, phone, email, source, note, matched_user_id, created_at").order("created_at", { ascending: false }).limit(200),
    svc.from("leads").select("id", { count: "exact", head: true }),
    svc.from("leads").select("id", { count: "exact", head: true }).not("matched_user_id", "is", null),
  ]);

  // Level (Final / Inter) for leads who are students — shown inline and
  // filterable, so nobody has to open Manage users to know the level.
  const matchedIds = [...new Set((leads ?? []).map((l) => l.matched_user_id as string | null).filter(Boolean))] as string[];
  const levelByUser = new Map<string, string>();
  if (matchedIds.length) {
    const { data: mc } = await svc.from("my_courses").select("student_id, courses(title)").in("student_id", matchedIds);
    for (const r of mc ?? []) {
      const t = ((r as { courses?: { title?: string } | null }).courses?.title ?? "").toLowerCase();
      const lvl = t.includes("final") ? "Final" : t.includes("inter") ? "Inter" : "";
      if (!lvl) continue;
      const cur = levelByUser.get(r.student_id as string);
      levelByUser.set(r.student_id as string, cur && cur !== lvl ? "Final + Inter" : lvl);
    }
  }
  const levelFilter = searchParams.level ?? "";
  const leadLevel = (l: { matched_user_id: string | null }) => (l.matched_user_id ? levelByUser.get(l.matched_user_id) ?? "" : "");
  const shownLeads = (leads ?? []).filter((l) => {
    if (!levelFilter) return true;
    const lvl = leadLevel(l as { matched_user_id: string | null });
    if (levelFilter === "none") return !lvl;
    return lvl.includes(levelFilter);
  });

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
                <option value="meta">Meta / Instagram lead ad (Forms Library CSV)</option>
                <option value="google">Google ad leads</option>
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
      {/* Level filter — see at a glance which course level each contact is. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {[["", "All"], ["Final", "📘 CA Final"], ["Inter", "📗 CA Inter"], ["none", "Not a student"]].map(([v, label]) => (
          <a
            key={v}
            href={v ? `/admin/leads?level=${v}` : "/admin/leads"}
            className="btn small secondary"
            style={levelFilter === v ? { background: "linear-gradient(90deg, var(--accent), var(--accent-2))", color: "#fff", borderColor: "transparent" } : undefined}
          >
            {label}
          </a>
        ))}
      </div>
      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        {shownLeads.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>📭 No leads {levelFilter ? "match this filter" : "yet — import your first list above"}.</p></div>}
        {shownLeads.map((l) => {
          const lvl = leadLevel(l as { matched_user_id: string | null });
          return (
          <div className="list-row" key={l.id}>
            <div>
              <span className="row-title">
                {l.name || l.phone || l.email}
                {lvl && <span style={{ background: "var(--bg-soft)", border: "1px solid var(--accent)", color: "var(--accent)", borderRadius: 999, padding: "1px 10px", fontSize: ".74rem", fontWeight: 700, marginLeft: 8, verticalAlign: "middle" }}>📘 {lvl}</span>}
              </span>
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
          );
        })}
      </div>
    </section>
  );
}
