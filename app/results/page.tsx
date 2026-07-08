import { tryServiceClient } from "@/lib/supabase/service";
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
    <div className="tile" style={{ textAlign: "center" }}>
      <div style={{ width: 104, height: 104, borderRadius: "50%", margin: "0 auto 12px", overflow: "hidden", border: "3px solid var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.8rem", fontWeight: 800, background: "var(--bg-soft,#eef2f1)", color: "var(--accent)" }}>
        {r.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.photo_url} alt={r.student_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          initials(r.student_name)
        )}
      </div>
      <h3 style={{ fontSize: "1.05rem", margin: "0 0 4px" }}>{r.student_name}</h3>
      {r.headline && <div style={{ display: "inline-block", background: "var(--accent)", color: "#fff", fontSize: ".74rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999 }}>{r.headline}</div>}
      <p className="muted" style={{ fontSize: ".82rem", margin: "8px 0 0" }}>{[r.attempt, r.marks].filter(Boolean).join(" · ")}</p>
      {r.quote && <p style={{ fontSize: ".9rem", marginTop: 8, fontStyle: "italic" }}>&ldquo;{r.quote}&rdquo;</p>}
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

  const groups: { title: string; match: (r: Result) => boolean }[] = [
    { title: "🏆 CA Final", match: (r) => (r.level || "") === "CA Final" },
    { title: "🏅 CA Intermediate", match: (r) => (r.level || "") === "CA Intermediate" },
    { title: "🌟 Our achievers", match: (r) => !["CA Final", "CA Intermediate"].includes(r.level || "") },
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
      </div>

      {results.length === 0 ? (
        <p className="muted" style={{ textAlign: "center" }}>🎓 Results will be published here soon.</p>
      ) : (
        groups.map((g) => {
          const list = results.filter(g.match);
          if (list.length === 0) return null;
          return (
            <div key={g.title} style={{ marginBottom: 8 }}>
              <h3 style={{ fontSize: "1.15rem", margin: "26px 0 14px" }}>{g.title}</h3>
              <div className="grid grid-3">
                {list.map((r) => <Card key={r.id} r={r} />)}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
