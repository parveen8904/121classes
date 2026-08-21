import { formatDateTime } from "@/lib/dates";
import Link from "next/link";
import AdminHero from "../../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads report — Admin" };

// A lead report his office can work down a row at a time: who enquired, how to
// reach them, where they came from, and whether they ever became a student.
// The Manage page is for acting on one lead; this is for reading them all.

const day = (s: string | null) =>
  s ? formatDateTime(s) : "—";

type Lead = {
  id: string; name: string | null; phone: string | null; email: string | null;
  source: string | null; note: string | null; matched_user_id: string | null; created_at: string;
};

const th: React.CSSProperties = { padding: "7px 9px", textAlign: "left", color: "var(--muted)", whiteSpace: "nowrap", fontWeight: 700 };
const td: React.CSSProperties = { padding: "7px 9px", verticalAlign: "top" };

export default async function LeadsReport(props: {
  searchParams: Promise<{ from?: string; to?: string; source?: string; status?: string }>;
}) {
  await assertArea("reports");
  const sp = await props.searchParams;
  const from = (sp.from ?? "").trim();
  const to = (sp.to ?? "").trim();
  const source = (sp.source ?? "").trim();
  const status = (sp.status ?? "").trim();

  const svc = createServiceClient();
  let q = svc.from("leads")
    .select("id, name, phone, email, source, note, matched_user_id, created_at")
    .order("created_at", { ascending: false })
    .limit(3000);
  if (from) q = q.gte("created_at", `${from}T00:00:00Z`);
  if (to) q = q.lte("created_at", `${to}T23:59:59Z`);
  if (source) q = q.eq("source", source);
  if (status === "converted") q = q.not("matched_user_id", "is", null);
  if (status === "open") q = q.is("matched_user_id", null);

  const { data } = await q;
  const leads = (data ?? []) as Lead[];

  // Every source that exists, asked of the database rather than reduced from a
  // sample. Selecting five thousand source strings out of a quarter of a
  // million missed any source used only by older leads — and a source missing
  // from the filter means those leads cannot be found at all.
  const { data: srcRows } = await svc.rpc("lead_sources");
  const sources = ((srcRows ?? []) as { source: string }[]).map((r) => r.source).filter(Boolean);

  // COUNTED, not measured off the page.
  //
  // The list above stops at three thousand rows — sensible for something a
  // person scrolls. But "enrolled" and the conversion rate were worked out
  // from that same slice, so with a quarter of a million leads they described
  // the first three thousand and were presented as the whole picture. The
  // numbers now come from the database, under the same filters as the list.
  const countWith = (extra?: (b: ReturnType<typeof svc.from>) => unknown) => {
    let c = svc.from("leads").select("id", { count: "exact", head: true });
    if (from) c = c.gte("created_at", `${from}T00:00:00Z`);
    if (to) c = c.lte("created_at", `${to}T23:59:59Z`);
    if (source) c = c.eq("source", source);
    if (status === "converted") c = c.not("matched_user_id", "is", null);
    if (status === "open") c = c.is("matched_user_id", null);
    return c;
  };
  const [{ count: totalCount }, { count: convertedCount }] = await Promise.all([
    countWith(),
    countWith().not("matched_user_id", "is", null),
  ]);
  const total = totalCount ?? leads.length;
  const converted = convertedCount ?? 0;

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 1100 }}>
      <AdminHero
        badge="📇 Leads"
        title="Every enquiry, and what became of it"
        subtitle="Who asked about the classes, how to reach them, where they came from, and whether they enrolled."
        back={{ href: "/admin/reports", label: "Reports" }}
      />

      <form className="card" style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
        <div><label style={{ fontSize: ".8rem" }}>From</label><input type="date" name="from" defaultValue={from} style={{ marginBottom: 0 }} /></div>
        <div><label style={{ fontSize: ".8rem" }}>To</label><input type="date" name="to" defaultValue={to} style={{ marginBottom: 0 }} /></div>
        <div>
          <label style={{ fontSize: ".8rem" }}>Source</label>
          <select name="source" defaultValue={source} style={{ marginBottom: 0 }}>
            <option value="">All sources</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: ".8rem" }}>Status</label>
          <select name="status" defaultValue={status} style={{ marginBottom: 0 }}>
            <option value="">All</option>
            <option value="converted">Enrolled</option>
            <option value="open">Not yet enrolled</option>
          </select>
        </div>
        <button className="btn small" type="submit">Filter</button>
        {(from || to || source || status) && <Link className="btn small secondary" href="/admin/reports/leads">Clear</Link>}
      </form>

      <div className="admin-cards" style={{ marginTop: 16, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        <div className="admin-tile"><div className="tile-ic">📇</div><h3 style={{ fontSize: "1.5rem" }}>{total.toLocaleString("en-IN")}</h3><p>leads{total > leads.length ? ` (showing ${leads.length.toLocaleString("en-IN")})` : ""}</p></div>
        <div className="admin-tile"><div className="tile-ic">🎓</div><h3 style={{ fontSize: "1.5rem" }}>{converted}</h3><p>enrolled</p></div>
        <div className="admin-tile">
          <div className="tile-ic">📈</div>
          <h3 style={{ fontSize: "1.5rem" }}>{total ? Math.round((converted / total) * 100) : 0}%</h3>
          <p>of these enrolled</p>
        </div>
      </div>

      <div style={{ overflowX: "auto", marginTop: 18 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
          <thead><tr>
            <th style={th}>Enquired</th><th style={th}>Name</th><th style={th}>Phone</th>
            <th style={th}>Email</th><th style={th}>Source</th><th style={th}>Note</th><th style={th}>Enrolled</th>
          </tr></thead>
          <tbody>
            {leads.length === 0 && (
              <tr><td style={td} colSpan={7}><span className="muted">No leads match this filter.</span></td></tr>
            )}
            {leads.map((l) => (
              <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={td}>{day(l.created_at)}</td>
                <td style={td}>{l.name || "—"}</td>
                <td style={td}>{l.phone || "—"}</td>
                <td style={td}>{l.email || "—"}</td>
                <td style={td}>{l.source || "—"}</td>
                <td style={{ ...td, maxWidth: 280 }}>{l.note || "—"}</td>
                <td style={td}>
                  {l.matched_user_id
                    ? <Link href={`/admin/users/${l.matched_user_id}`}>✅ yes</Link>
                    : <span className="muted">not yet</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
