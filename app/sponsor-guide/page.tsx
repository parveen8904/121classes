import Link from "next/link";
import { SPONSOR_GUIDE } from "@/lib/sponsorGuide";

export const revalidate = 3600;
export const metadata = { title: "Sponsor a Student — Guide | CA Parveen Sharma", description: "How to sponsor a CA student and what they receive." };

export default function SponsorGuidePage() {
  const g = SPONSOR_GUIDE;
  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
        <div style={{ background: "linear-gradient(135deg,#0d9488,#10b981)", color: "#fff", borderRadius: 18, padding: "28px 26px" }}>
          <h1 style={{ color: "#fff", margin: 0 }}>🎁 {g.title}</h1>
          <p style={{ margin: "6px 0 0", opacity: 0.95 }}>{g.tagline}</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <Link className="btn" href="/gift">Sponsor now →</Link>
          <a className="btn secondary" href="/sponsor-guide/pdf" target="_blank" rel="noopener noreferrer">⬇️ Download this guide (PDF)</a>
        </div>
        <p className="muted" style={{ marginTop: 18, lineHeight: 1.65 }}>{g.intro}</p>

        {g.sections.map((sec) => (
          <div key={sec.heading} style={{ marginTop: 22 }}>
            <h2 style={{ fontSize: "1.2rem", color: "var(--accent)" }}>{sec.heading}</h2>
            {"bullets" in sec && sec.bullets && (
              <ul style={{ display: "grid", gap: 8, paddingLeft: 20, marginTop: 8 }}>
                {sec.bullets.map((b) => <li key={b} style={{ lineHeight: 1.5 }}>{b}</li>)}
              </ul>
            )}
            {"steps" in sec && sec.steps && (
              <ol style={{ display: "grid", gap: 10, paddingLeft: 22, marginTop: 8 }}>
                {sec.steps.map((s) => <li key={s} style={{ lineHeight: 1.5 }}>{s}</li>)}
              </ol>
            )}
          </div>
        ))}

        <div className="card" style={{ marginTop: 22, borderLeft: "4px solid var(--accent)" }}>
          <strong>🎟️ {g.couponNote}</strong>
        </div>
        <p className="muted" style={{ marginTop: 16 }}>{g.contact}</p>
      </section>
    </main>
  );
}
