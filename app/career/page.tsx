import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Career Corner — 121 CA Classes" };

// Live job-search shortcuts (open Google/portals pre-filtered for CA roles).
const JOB_SEARCHES = [
  { label: "🔎 Google jobs", url: "https://www.google.com/search?q=CA+articleship+jobs+near+me&ibp=htl;jobs" },
  { label: "Naukri", url: "https://www.naukri.com/chartered-accountant-jobs" },
  { label: "LinkedIn", url: "https://www.linkedin.com/jobs/search/?keywords=Chartered%20Accountant%20articleship" },
  { label: "Indeed", url: "https://in.indeed.com/jobs?q=CA+articleship" },
];

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

      {/* Job openings */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 8px" }}>💼 Job &amp; articleship openings</h3>
        {jobs.length > 0 && (
          <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
            {jobs.map((j, i) => <li key={i} style={{ marginBottom: 4 }}>{j}</li>)}
          </ul>
        )}
        <p className="muted" style={{ fontSize: ".85rem", margin: "0 0 8px" }}>Find more live openings:</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {JOB_SEARCHES.map((s) => (
            <a key={s.label} className="btn small secondary" href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
          ))}
        </div>
      </div>
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
