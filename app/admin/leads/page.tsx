import { formatDate } from "@/lib/dates";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import DeleteButton from "../_components/DeleteButton";
import SubmitButton from "@/app/components/SubmitButton";
import { deleteLead, addLeadManual } from "./actions";
import ImportClient from "./ImportClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads — Admin" };

const SOURCE_LABEL: Record<string, string> = {
  csv: "📄 CSV import", interakt: "💬 Interakt export", whatsapp: "💬 WhatsApp",
  youtube: "▶️ YouTube", landing: "🪄 Free-planner page", manual: "✍️ Manual",
  meta: "💰 Meta/Instagram ad", google: "💰 Google ad", popup: "🧩 Site popup", phone: "📞 Phone call", other: "Other",
};

export default async function LeadsPage(
  props: { searchParams: Promise<{ msg?: string; added?: string; students?: string; dupes?: string; level?: string; q?: string; source?: string; status?: string }> }
) {
  const searchParams = await props.searchParams;
  const q = (searchParams.q ?? "").trim();
  const source = (searchParams.source ?? "").trim();
  const status = (searchParams.status ?? "").trim();
  const svc = createServiceClient();

  // A QUARTER OF A MILLION BOUGHT ROWS WERE BURYING EVERYTHING ELSE.
  //
  // This showed the newest 200 leads and nothing more. 255,546 of them came in
  // on a purchased CSV, so the 586 people who filled in a Google ad form — with
  // an email each and 428 phone numbers between them — sat somewhere past row
  // 200 and could not be reached from any screen. They were not missing; they
  // were unreachable, which from a desk looks the same.
  //
  // The list can now be cut by where a lead came from and by whether they ever
  // became a student, and every count below is a real count over the whole
  // table rather than over the 200 that happened to load.
  let leadsQ = svc.from("leads")
    .select("id, name, phone, email, source, note, matched_user_id, created_at")
    .order("created_at", { ascending: false }).limit(400);
  if (q) leadsQ = leadsQ.or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,note.ilike.%${q}%`);
  if (source) leadsQ = leadsQ.eq("source", source);
  if (status === "new") leadsQ = leadsQ.is("matched_user_id", null);
  if (status === "student") leadsQ = leadsQ.not("matched_user_id", "is", null);

  const [{ data: leads }, { count: total }, { count: matched }, { data: bySourceRows }] = await Promise.all([
    leadsQ,
    svc.from("leads").select("id", { count: "exact", head: true }),
    svc.from("leads").select("id", { count: "exact", head: true }).not("matched_user_id", "is", null),
    svc.rpc("lead_source_counts"),
  ]);

  type SourceCount = { source: string; leads: number; not_students: number; with_phone: number };
  const bySource = ((bySourceRows ?? []) as unknown as SourceCount[])
    .slice().sort((a, b) => b.not_students - a.not_students);

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
      {m === "imported" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Import complete — the counts below are up to date.</div>}
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

      {/* ── WHERE EACH LEAD CAME FROM, AND HOW MANY WERE NEVER CALLED ────
          The one table that answers "where is that list". Counted over the
          whole database, not over the rows this page happened to load, and
          sorted by how many are still waiting rather than by how many there
          are — a bought list of a quarter of a million is not the thing that
          needs working today. */}
      <h2 className="admin-section-title" style={{ marginTop: 22 }}>Where your leads came from</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".86rem" }}>
          <thead><tr>
            <th style={{ padding: "7px 9px", textAlign: "left", color: "var(--muted)" }}>Source</th>
            <th style={{ padding: "7px 9px", textAlign: "right", color: "var(--muted)" }}>Leads</th>
            <th style={{ padding: "7px 9px", textAlign: "right", color: "var(--muted)" }}>With a phone</th>
            <th style={{ padding: "7px 9px", textAlign: "right", color: "var(--muted)" }}>Not yet students</th>
            <th style={{ padding: "7px 9px", textAlign: "left", color: "var(--muted)" }}></th>
          </tr></thead>
          <tbody>
            {bySource.map((r) => (
              <tr key={r.source} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "7px 9px" }}>{SOURCE_LABEL[r.source] ?? r.source}</td>
                <td style={{ padding: "7px 9px", textAlign: "right" }}>{r.leads.toLocaleString("en-IN")}</td>
                <td style={{ padding: "7px 9px", textAlign: "right" }}>{r.with_phone.toLocaleString("en-IN")}</td>
                <td style={{ padding: "7px 9px", textAlign: "right", fontWeight: 700 }}>{r.not_students.toLocaleString("en-IN")}</td>
                <td style={{ padding: "7px 9px" }}>
                  <a className="btn small secondary" href={`/admin/leads?source=${encodeURIComponent(r.source)}&status=new`}>
                    Show the {r.not_students.toLocaleString("en-IN")} waiting →
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: ".82rem", lineHeight: 1.7, marginTop: 8 }}>
        A <strong>CSV import</strong> is a list that was bought or handed over — those people did not ask to hear
        from us, and messaging them in bulk is a decision to take deliberately. Every other row is somebody who
        typed their own details into our own site or rang the office.
      </p>

      {/* Import — batched in the browser, so file size is not a limit. */}
      <ImportClient />

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
      <h2 className="admin-section-title" style={{ marginTop: 24 }}>
        📇 {source ? SOURCE_LABEL[source] ?? source : "Latest leads"}
        {status === "new" ? " — not yet students" : status === "student" ? " — already students" : ""}
      </h2>
      {(source || status) && (
        <p style={{ marginTop: -4 }}>
          <a className="btn small secondary" href="/admin/leads">← Everything again</a>
          <span className="muted" style={{ fontSize: ".82rem", marginLeft: 10 }}>
            Showing {shownLeads.length} of these, newest first.
          </span>
        </p>
      )}
      {/* Search */}
      <form style={{ marginTop: 10 }}>
        {searchParams.level && <input type="hidden" name="level" value={searchParams.level} />}
        <div style={{ display: "flex", gap: 8, maxWidth: 480 }}>
          <input name="q" defaultValue={q} placeholder="🔍 Search name, phone, email, note…" style={{ marginBottom: 0 }} />
          <SubmitButton className="btn small" savedLabel="✓">Search</SubmitButton>
        </div>
      </form>
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
                {` · ${formatDate(l.created_at)}`}
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
