import AdminHero from "../_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";
import AutoRefresh from "./AutoRefresh";

export const dynamic = "force-dynamic";
export const metadata = { title: "Server health — Admin" };

type Health = {
  at: string;
  active_students_20m: number;
  active_students_1h: number;
  connections: { total: number; active: number; idle: number; idle_in_tx: number; max: number };
  queries: { running: number; waiting_on_lock: number; longest_seconds: number; longest_query: string | null };
  cache_hit_ratio: number | null;
  db_size: string;
  top_tables: { name: string; size: string }[];
  top_queries: { query: string; calls: number; mean_ms: number; total_ms: number }[];
  has_query_stats: boolean;
};

function verdict(h: Health): { light: string; label: string; note: string; color: string; bg: string } {
  const c = h.connections;
  const q = h.queries;
  const connPct = c.max ? c.total / c.max : 0;
  const red =
    connPct >= 0.85 || q.longest_seconds >= 30 || q.waiting_on_lock >= 3;
  const amber =
    connPct >= 0.6 || q.running >= 10 || q.longest_seconds >= 8 || (h.cache_hit_ratio ?? 100) < 95;
  if (red)
    return {
      light: "🔴",
      label: "Overloaded",
      note: "The database is under heavy pressure. Stop any bulk uploads/imports, and message the tech team. Students may see slow pages until it clears.",
      color: "#b91c1c",
      bg: "rgba(239,68,68,.10)",
    };
  if (amber)
    return {
      light: "🟠",
      label: "Busy",
      note: "Getting busy but still serving. Don't start big uploads or student imports right now — wait for it to go green.",
      color: "#b45309",
      bg: "rgba(234,179,8,.12)",
    };
  return {
    light: "🟢",
    label: "All good",
    note: "The server is healthy and responsive. Normal work is safe.",
    color: "#16a34a",
    bg: "rgba(34,197,94,.10)",
  };
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: "12px 14px" }}>
      <div style={{ fontSize: ".74rem", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800, lineHeight: 1.1, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: ".72rem", color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default async function HealthPage() {
  const svc = createServiceClient();
  const { data, error } = await svc.rpc("admin_server_health");
  const h = data as Health | null;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 1000 }}>
      <AdminHero
        badge="🩺 Server health"
        title="Server health — live"
        subtitle="How busy the server is right now, what is using it, and what to do if it slows down. 📊"
        back={{ href: "/admin", label: "Admin" }}
      />

      {(!h || error) ? (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="muted">Couldn&apos;t read the server snapshot{error ? `: ${error.message}` : ""}. Refresh in a moment.</p>
        </div>
      ) : (
        <>
          {(() => {
            const v = verdict(h);
            return (
              <div style={{ background: v.bg, border: `2px solid ${v.color}`, borderRadius: 14, padding: "18px 20px", marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: "2rem" }}>{v.light}</span>
                    <div>
                      <div style={{ fontSize: "1.3rem", fontWeight: 800, color: v.color }}>{v.label}</div>
                      <div style={{ fontSize: ".9rem", color: "var(--text)", maxWidth: 620 }}>{v.note}</div>
                    </div>
                  </div>
                  <AutoRefresh seconds={15} />
                </div>
              </div>
            );
          })()}

          {/* Right now */}
          <h3 style={{ margin: "22px 0 8px" }}>👥 Right now</h3>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
            <Stat label="Students active (approx.)" value={String(h.active_students_1h)} sub={`${h.active_students_20m} in the last 20 min`} />
            <Stat label="Database connections" value={`${h.connections.total} / ${h.connections.max}`} sub={`${h.connections.active} working · ${h.connections.idle} idle`} />
            <Stat label="Queries running now" value={String(h.queries.running)} sub={h.queries.waiting_on_lock ? `${h.queries.waiting_on_lock} waiting on a lock` : "none waiting"} />
            <Stat label="Longest query now" value={`${h.queries.longest_seconds}s`} sub={h.queries.longest_seconds >= 5 ? "⚠️ something is slow" : "healthy"} />
            <Stat label="Memory cache hit" value={h.cache_hit_ratio != null ? `${h.cache_hit_ratio}%` : "—"} sub={(h.cache_hit_ratio ?? 100) >= 99 ? "excellent" : "watch this"} />
            <Stat label="Database size" value={h.db_size} sub="grows slowly" />
          </div>
          <p className="muted" style={{ fontSize: ".76rem", marginTop: 6 }}>
            &ldquo;Students active&rdquo; is approximate (based on live sessions). Videos stream from Bunny&apos;s CDN, not this
            server, so watching classes barely loads the database — logins and page-opens are the real load.
          </p>

          {/* Where the time goes */}
          {h.has_query_stats && h.top_queries.length > 0 && (
            <>
              <h3 style={{ margin: "22px 0 8px" }}>⚙️ Where the server time goes (all-time)</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                      <th style={{ padding: "6px 8px" }}>Query (start)</th>
                      <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>Times run</th>
                      <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>Avg time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.top_queries.map((q, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: ".74rem" }}>{q.query}…</td>
                        <td style={{ padding: "6px 8px" }}>{q.calls.toLocaleString("en-IN")}</td>
                        <td style={{ padding: "6px 8px", color: q.mean_ms >= 500 ? "#b91c1c" : q.mean_ms >= 100 ? "#b45309" : "inherit", fontWeight: q.mean_ms >= 100 ? 700 : 400 }}>
                          {q.mean_ms >= 1000 ? `${(q.mean_ms / 1000).toFixed(1)}s` : `${Math.round(q.mean_ms)}ms`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: ".76rem", marginTop: 6 }}>
                Rows in red/amber are the slowest. If the same query keeps showing red, send this screen to the tech team —
                it points straight at what to optimise.
              </p>
            </>
          )}

          {/* Biggest tables */}
          {h.top_tables.length > 0 && (
            <>
              <h3 style={{ margin: "22px 0 8px" }}>💾 Biggest tables</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {h.top_tables.map((t) => (
                  <span key={t.name} className="card" style={{ padding: "6px 12px", fontSize: ".82rem" }}>
                    <strong>{t.name}</strong> · {t.size}
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Staff runbook */}
      <h3 style={{ margin: "26px 0 8px" }}>🧑‍💼 What staff should do (no tech knowledge needed)</h3>
      <div className="card">
        <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8, fontSize: ".9rem" }}>
          <li><strong>🟢 Green</strong> — everything is fine. Carry on with normal work.</li>
          <li><strong>🟠 Amber</strong> — pause any big uploads or student imports. Wait a few minutes for green.</li>
          <li><strong>🔴 Red</strong> — stop all uploads/imports immediately. Message the tech team with a screenshot of this page. Students can still watch classes (video is on a separate network).</li>
          <li>To shed load fast, you can temporarily turn off AI features on the <a href="/admin/ai-usage">AI usage &amp; controls</a> page — the site keeps working, only AI doubt-answers pause.</li>
          <li>Never run a bulk student import or a big &ldquo;prepare all&rdquo; job during the busy evening/night hours.</li>
        </ol>
      </div>

      {/* Bulk-import guidance */}
      <h3 style={{ margin: "26px 0 8px" }}>📥 Importing ~1000 students from the old site</h3>
      <div className="card">
        <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8, fontSize: ".9rem" }}>
          <li><strong>Do it in small batches</strong> (100–200 at a time), not all 1000 at once — a single huge import + a flood of &ldquo;set your password&rdquo; emails can overwhelm login and land in spam.</li>
          <li><strong>Import in the morning/afternoon</strong> when this page is green, never during peak evening/night.</li>
          <li><strong>Fix the auth connection limit first</strong> (Supabase → Database → Connection pooling, percentage-based) or 1000 first-time logins will queue.</li>
          <li><strong>The data itself is tiny</strong> — 1000 student rows barely change the database size. The load is the login surge and the emails, which batching solves.</li>
          <li>After each batch, glance at this page. Green → continue. Amber/Red → wait.</li>
        </ul>
      </div>
    </section>
  );
}
