import { tryServiceClient } from "@/lib/supabase/service";
import { lightImg } from "@/lib/img";
import CountUp from "@/app/components/CountUp";

// Public marketing page — cache it and refresh every 5 minutes.
export const revalidate = 300;
export const metadata = {
  title: "Results — CA Parveen Sharma",
  description: "Rank-holders and successes mentored by CA Parveen Sharma & team — CA Final and CA Intermediate.",
};

type Result = { id: string; student_name: string; headline: string | null; attempt: string | null; marks: string | null; quote: string | null; photo_url: string | null; level: string | null };

const GRAD = "linear-gradient(135deg,#0d9488,#10b981)";

const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

function Card({ r }: { r: Result }) {
  return (
    <div style={{
      textAlign: "center",
      background: "linear-gradient(160deg, color-mix(in srgb, var(--accent) 10%, var(--card)), var(--card))",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: "10px 6px 8px",
    }}>
      <div style={{ width: 78, height: 78, borderRadius: "50%", margin: "0 auto 6px", overflow: "hidden", border: "2px solid var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", fontWeight: 800, background: "var(--bg-soft,#eef2f1)", color: "var(--accent)" }}>
        {r.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lightImg(r.photo_url, 128)} loading="lazy" decoding="async" alt={r.student_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          initials(r.student_name)
        )}
      </div>
      {r.headline && <div style={{ fontWeight: 900, fontSize: "1.45rem", lineHeight: 1.05, letterSpacing: ".5px", color: "var(--accent)" }}>{r.headline}</div>}
      <div style={{ fontWeight: 800, fontSize: ".95rem", marginTop: 2, lineHeight: 1.15 }}>{r.student_name}</div>
      <div className="muted" style={{ fontSize: ".68rem", marginTop: 2 }}>{[r.level?.replace("CA ", ""), r.attempt, r.marks].filter(Boolean).join(" · ")}</div>
      {r.quote && <p style={{ fontSize: ".78rem", marginTop: 6, fontStyle: "italic" }}>&ldquo;{r.quote}&rdquo;</p>}
    </div>
  );
}

export default async function ResultsPage() {
  const supabase = tryServiceClient();
  if (!supabase) return null; // local build without env — Vercel always has it
  const { data } = await supabase
    .from("results")
    .select("id, student_name, headline, attempt, marks, quote, photo_url, level")
    .eq("is_published", true)
    .order("order_index")
    .order("created_at", { ascending: false });
  const results = (data ?? []) as Result[];

  // One combined list: every ranker, AIR 1 at the top moving downwards; results
  // without an AIR rank follow at the end. No Final/Inter separation.
  const airRank = (h?: string | null) => { const m = /AIR\s*(\d+)/i.exec(h ?? ""); return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY; };
  // Same rank → the LATEST exam attempt comes first.
  const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  const attemptKey = (a?: string | null) => {
    const m = /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[^0-9]*(\d{4})/i.exec((a ?? "").toUpperCase());
    return m ? Number(m[2]) * 12 + MONTHS[m[1]] : 0;
  };
  const sorted = [...results].sort((a, b) =>
    (airRank(a.headline) - airRank(b.headline)) ||
    (attemptKey(b.attempt) - attemptKey(a.attempt)));
  const groups: { title: string; match: (r: Result) => boolean }[] = [
    { title: "🏆 Our rankers", match: (r) => Number.isFinite(airRank(r.headline)) },
    { title: "🌟 Our achievers", match: (r) => !Number.isFinite(airRank(r.headline)) },
  ];

  return (
    <section className="section">
      <div style={{ background: GRAD, color: "#fff", borderRadius: 22, padding: "40px 28px", textAlign: "center", marginBottom: 8 }}>
        <span style={{ display: "inline-block", background: "rgba(255,255,255,.18)", padding: "4px 12px", borderRadius: 999, fontSize: ".8rem", fontWeight: 700 }}>🏆 Results</span>
        <h1 style={{ color: "#fff", fontSize: "2rem", margin: "14px 0 8px" }}>Our students. Our pride.</h1>
        <p style={{ maxWidth: 620, margin: "0 auto", fontSize: "1.02rem", color: "rgba(255,255,255,.95)" }}>
          Real rank-holders mentored by <strong>CA Parveen Sharma &amp; team</strong> — with disciplined plans, doubt-solving and revision that actually work. 🎯
        </p>
        {results.length > 0 && <div style={{ fontSize: "2rem", fontWeight: 800, marginTop: 16 }}><CountUp value={results.length} suffix="+" /> <span style={{ fontSize: ".9rem", fontWeight: 500, opacity: .92 }}>success stories</span></div>}
        <div style={{ marginTop: 18 }}>
          <a className="btn" href="/awards" style={{ background: "#fff", color: "#0d9488", fontWeight: 800 }}>🎖️ Studied with us? Tell us your result &amp; get an award →</a>
        </div>
      </div>

      {results.length === 0 ? (
        <p className="muted" style={{ textAlign: "center" }}>🎓 Results will be published here soon.</p>
      ) : (
        groups.map((g) => {
          const list = sorted.filter(g.match);
          if (list.length === 0) return null;
          return (
            <div key={g.title} style={{ marginBottom: 8 }}>
              <h3 style={{ fontSize: "1.15rem", margin: "26px 0 14px" }}>{g.title}</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))", gap: 8 }}>
                {list.map((r) => <Card key={r.id} r={r} />)}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
