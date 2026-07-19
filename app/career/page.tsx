import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CareerOpenings, { type Opening } from "./CareerOpenings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Career Corner — CA Parveen Sharma" };

// Each opening line: "Title | Firm | Location | applyLinkOrEmail"
function parseJob(line: string) {
  const [title, firm, location, apply] = line.split("|").map((s) => s.trim());
  let href = apply || "";
  if (href && !/^https?:|^mailto:/.test(href)) href = href.includes("@") ? `mailto:${href}` : `https://${href}`;
  return { title, firm, location, href };
}

function Block({ icon, title, body }: { icon: string; title: string; body: string }) {
  if (!body?.trim()) return null;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3 style={{ margin: "0 0 8px" }}>{icon} {title}</h3>
      <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{body}</p>
    </div>
  );
}

export default async function CareerPage(props: { searchParams: Promise<{ city?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/career");

  const { data } = await supabase.from("site_settings").select("key, value").in("key", ["career_articleship", "career_placement", "career_resources", "career_jobs", "career_links", "career_cities"]);
  const m = new Map((data ?? []).map((r) => [r.key, r.value as string]));

  const any = ["career_articleship", "career_placement", "career_resources", "career_jobs"].some((k) => (m.get(k) || "").trim());
  const jobs = (m.get("career_jobs") || "").split("\n").map((l) => l.trim()).filter(Boolean);

  // Auto-aggregated, admin-approved openings, grouped by category.
  const { data: listingsRaw } = await supabase
    .from("job_listings")
    .select("id, title, company, location, url, category, source, posted_at, created_at")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(300);
  // Auto-expire: hide openings older than 45 days so the page stays current.
  const FRESH_MS = 45 * 24 * 3600 * 1000;
  const now = Date.now();
  const dateOf = (j: { posted_at: string | null; created_at: string }) => Date.parse(j.posted_at || j.created_at);
  const listings = (listingsRaw ?? []).filter((j) => now - dateOf(j) < FRESH_MS);
  const ago = (j: { posted_at: string | null; created_at: string }) => {
    const days = Math.floor((now - dateOf(j)) / (24 * 3600 * 1000));
    if (isNaN(days)) return "";
    return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
  };
  // City list (first part of each location) for the filter dropdown.
  const cityOf = (loc: string | null) => (loc || "").split(/[,|]/)[0].trim();
  const cities = [...new Set((listings ?? []).map((j) => cityOf(j.location)).filter(Boolean))].sort();
  const selectedCity = (searchParams.city || "").trim();
  const shown = selectedCity
    ? (listings ?? []).filter((j) => (j.location || "").toLowerCase().includes(selectedCity.toLowerCase()))
    : (listings ?? []);


  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
      <p className="crumb"><Link href="/dashboard">← Dashboard</Link></p>
        <div className="learn-hero">
        <span className="badge">🎓 Career Corner</span>
        <h1>Career corner</h1>
        <p className="meta">Articleship, placements, interviews and opportunities — guidance from CA Parveen Sharma &amp; team.</p>
      </div>

      {/* Tools */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
        <Link className="btn" href="/career/cv">📄 Build my CV</Link>
        <Link className="btn secondary" href="/career/interview">🎤 AI mock interview</Link>
      </div>

      {/* Nova Seed Capital — the founder's startup-grooming venture */}
      <Link href="/startups" className="card" style={{ display: "block", marginTop: 16, border: "2px solid var(--accent)", color: "var(--text)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "1.9rem" }}>🚀</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <strong>Have a startup? Nova Seed Capital grooms new startups.</strong>
            <p className="muted" style={{ margin: "3px 0 0", fontSize: ".85rem" }}>
              A venture by CA Parveen Sharma — bring your idea or early-stage startup and get it groomed. Tap to learn more →
            </p>
          </div>
        </div>
      </Link>

      {/* Nova Seed Capital — the founder's startup-grooming venture */}
      <Link href="/startups" className="card" style={{ display: "block", marginTop: 16, border: "2px solid var(--accent)", color: "var(--text)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "1.9rem" }}>🚀</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <strong>Have a startup? Nova Seed Capital grooms new startups.</strong>
            <p className="muted" style={{ margin: "3px 0 0", fontSize: ".85rem" }}>
              A venture by CA Parveen Sharma — bring your idea or early-stage startup and get it groomed. Tap to learn more →
            </p>
          </div>
        </div>
      </Link>


      {/* City filter */}
      {cities.length > 1 && (
        <form method="get" style={{ marginTop: 20, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ margin: 0, fontSize: ".9rem" }}>📍 Filter by city</label>
          <select name="city" defaultValue={selectedCity} style={{ marginBottom: 0, maxWidth: 220 }}>
            <option value="">All cities</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn small secondary" type="submit">Apply</button>
        </form>
      )}

      {/* Auto-aggregated openings — paginated so the page stays short. */}
      <CareerOpenings
        city={selectedCity}
        openings={shown.map((j): Opening => ({
          id: j.id as string,
          title: j.title as string,
          category: (j.category as string) || "Other",
          meta: [j.company, j.location, j.source, ago(j)].filter(Boolean).join(" · "),
          url: j.url as string,
        }))}
      />

      {/* Manually posted openings (optional, in addition to the feed) */}
      {jobs.length > 0 && (
        <>
          <h2 style={{ marginTop: 24, fontSize: "1.15rem" }}>💼 {shown.length > 0 ? "More" : "Job &amp; articleship"} openings</h2>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {jobs.map((line, i) => {
              const j = parseJob(line);
              return (
                <div className="card" key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <strong>{j.title || line}</strong>
                    {(j.firm || j.location) && (
                      <p className="muted" style={{ fontSize: ".85rem", margin: "2px 0 0" }}>
                        {[j.firm, j.location].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  {j.href && <a className="btn small" href={j.href} target="_blank" rel="noreferrer">Apply →</a>}
                </div>
              );
            })}
          </div>
        </>
      )}
      {jobs.length === 0 && shown.length === 0 && (
        <>
          <h2 style={{ marginTop: 24, fontSize: "1.15rem" }}>💼 Job &amp; articleship openings</h2>
          <div className="card" style={{ marginTop: 10 }}><p className="muted">No openings posted right now — check back soon. ✨</p></div>
        </>
      )}
      {any ? (
        <>
          <Block icon="📄" title="Articleship guidance" body={m.get("career_articleship") || ""} />
          <Block icon="💼" title="Placement & interviews" body={m.get("career_placement") || ""} />
          <Block icon="🔗" title="Resources & opportunities" body={m.get("career_resources") || ""} />
        </>
      ) : (
        <div className="card" style={{ marginTop: 16 }}><p className="muted">Career guidance is coming soon. ✨</p></div>
      )}
    </section>
  );
}
