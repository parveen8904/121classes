import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Career Corner — 121 CA Classes" };

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

export default async function CareerPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/career");

  const { data } = await supabase.from("site_settings").select("key, value").in("key", ["career_articleship", "career_placement", "career_resources", "career_jobs"]);
  const m = new Map((data ?? []).map((r) => [r.key, r.value as string]));
  const any = ["career_articleship", "career_placement", "career_resources", "career_jobs"].some((k) => (m.get(k) || "").trim());
  const jobs = (m.get("career_jobs") || "").split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
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

      {/* Job openings — shown here with an Apply link */}
      <h2 style={{ marginTop: 24, fontSize: "1.15rem" }}>💼 Job &amp; articleship openings</h2>
      {jobs.length > 0 ? (
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
      ) : (
        <div className="card" style={{ marginTop: 10 }}><p className="muted">No openings posted right now — check back soon. ✨</p></div>
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
