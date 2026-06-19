import AdminHero from "../_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { JOB_CATEGORIES } from "@/lib/ai";
import SubmitButton from "@/app/components/SubmitButton";
import { saveJobSources, fetchJobsNow, approveJob, rejectJob, deleteJob } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Student Placement — Admin" };

export default async function PlacementAdmin({ searchParams }: { searchParams: { fetched?: string; saved?: string } }) {
  const svc = createServiceClient();
  const [{ data: pending }, { data: approved }, jooble, queries, location, feeds, digestEmail] = await Promise.all([
    svc.from("job_listings").select("id, title, company, location, url, snippet, category, source").eq("status", "new").order("created_at", { ascending: false }).limit(150),
    svc.from("job_listings").select("id, title, company, category").eq("status", "approved").order("created_at", { ascending: false }).limit(100),
    getSecret("JOOBLE_API_KEY"),
    getSecret("JOB_QUERIES"),
    getSecret("JOB_LOCATION"),
    getSecret("JOB_FEEDS"),
    getSecret("PLACEMENT_DIGEST_EMAIL"),
  ]);

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 920 }}>
      <AdminHero
        badge="🎓 Student placement"
        title="Job openings — fetch, categorise, approve"
        subtitle="We pull CA openings from job sites automatically. You don't type anything — just set the category and approve; approved ones show on the public Career page."
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.fetched !== undefined && (
        <div className="notice ok" style={{ marginTop: 16 }}>✅ Fetched {searchParams.fetched} new opening(s) — below, awaiting your approval.</div>
      )}
      {searchParams.saved && <div className="notice ok" style={{ marginTop: 16 }}>✅ Sources saved.</div>}

      {/* Sources */}
      <div className="form-card" style={{ marginTop: 18 }}>
        <h3>🔌 Where openings come from</h3>
        <p className="muted" style={{ fontSize: ".85rem", marginTop: 0 }}>
          The free <strong>Jooble</strong> API aggregates Naukri, Indeed, company career pages and more. Get a free key at{" "}
          <a href="https://jooble.org/api/about" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>jooble.org/api/about</a> and paste it below. You can also add job RSS feeds (e.g. Google Jobs, a firm&apos;s careers feed).
        </p>
        <form action={saveJobSources}>
          <label>Jooble API key</label>
          <input name="JOOBLE_API_KEY" defaultValue={jooble} placeholder="paste your free Jooble key" />
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr" }}>
            <div>
              <label>Search terms (one per line)</label>
              <textarea name="JOB_QUERIES" rows={3} defaultValue={queries} placeholder={"Chartered Accountant\nCA articleship\nCA fresher"} />
            </div>
            <div>
              <label>Location</label>
              <input name="JOB_LOCATION" defaultValue={location || "India"} placeholder="India" />
            </div>
          </div>
          <label>Job RSS/Atom feed URLs (optional, one per line)</label>
          <textarea name="JOB_FEEDS" rows={2} defaultValue={feeds} placeholder={"https://…/jobs/rss"} />
          <label>📧 Email me new openings each morning (digest)</label>
          <input name="PLACEMENT_DIGEST_EMAIL" type="email" defaultValue={digestEmail} placeholder="you@example.com (leave blank for no email)" />
          <SubmitButton className="btn" style={{ marginTop: 10 }}>Save sources</SubmitButton>
        </form>
        <form action={fetchJobsNow} style={{ marginTop: 8 }}>
          <SubmitButton className="btn secondary" savedLabel="✓ Fetched">⤵️ Fetch latest openings now</SubmitButton>
        </form>
      </div>

      {/* Pending review */}
      <h2 className="admin-section-title" style={{ marginTop: 28 }}>📥 To review ({pending?.length ?? 0})</h2>
      {!pending || pending.length === 0 ? (
        <div className="card"><p className="muted">Nothing to review. Set a Jooble key above and tap &ldquo;Fetch latest openings now&rdquo;.</p></div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {pending.map((j) => (
            <div className="card" key={j.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <a href={j.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700, color: "var(--accent)" }}>{j.title}</a>
                  <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0 0" }}>
                    {[j.company, j.location, j.source].filter(Boolean).join(" · ")}
                  </p>
                  {j.snippet && <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 0" }}>{j.snippet.slice(0, 220)}</p>}
                </div>
              </div>
              <form action={approveJob} style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input type="hidden" name="id" value={j.id} />
                <select name="category" defaultValue={j.category ?? "Other"} style={{ marginBottom: 0, maxWidth: 200 }}>
                  {JOB_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <SubmitButton className="btn small" savedLabel="✓ Approved">Approve &amp; publish</SubmitButton>
              </form>
              <form action={rejectJob} style={{ marginTop: 6 }}>
                <input type="hidden" name="id" value={j.id} />
                <SubmitButton className="btn small secondary" savedLabel="✓ Hidden">Reject</SubmitButton>
              </form>
            </div>
          ))}
        </div>
      )}

      {/* Approved (live) */}
      <h2 className="admin-section-title" style={{ marginTop: 28 }}>✅ Live on the Career page ({approved?.length ?? 0})</h2>
      <div style={{ display: "grid", gap: 6 }}>
        {(approved ?? []).map((j) => (
          <div key={j.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 12px", background: "var(--bg-soft)", borderRadius: 8 }}>
            <span style={{ minWidth: 0 }}><strong>{j.title}</strong> <span className="muted" style={{ fontSize: ".8rem" }}>· {j.category}{j.company ? ` · ${j.company}` : ""}</span></span>
            <form action={deleteJob}>
              <input type="hidden" name="id" value={j.id} />
              <SubmitButton className="btn small secondary" savedLabel="✓ Removed">Remove</SubmitButton>
            </form>
          </div>
        ))}
      </div>
    </section>
  );
}
