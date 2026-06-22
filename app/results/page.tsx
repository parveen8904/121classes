import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Results — CA Parveen Sharma",
  description: "Rank-holders and successes mentored by CA Parveen Sharma & team — CA Final and CA Intermediate.",
};

type Result = { id: string; student_name: string; headline: string | null; attempt: string | null; marks: string | null; quote: string | null; photo_url: string | null; level: string | null };

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
  const supabase = createClient();
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
      <div className="section-head">
        <span className="eyebrow">🏆 Results</span>
        <h2>Our students. Our pride.</h2>
        <p>Real rank-holders and successes mentored by <strong>CA Parveen Sharma &amp; team</strong> — with disciplined plans, doubt-solving and revision that actually work.</p>
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
