import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const supabase = createClient();
  const { data: results } = await supabase
    .from("results")
    .select("id, student_name, headline, attempt, marks, quote, photo_url")
    .eq("is_published", true)
    .order("order_index")
    .order("created_at", { ascending: false });

  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">🏆 Results</span>
        <h2>Our students. Our pride.</h2>
        <p>Rank-holders and successes mentored by CA Parveen Sharma &amp; team.</p>
      </div>

      {results && results.length > 0 ? (
        <div className="grid grid-3">
          {results.map((r) => (
            <div className="tile" key={r.id} style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: "50%",
                  margin: "0 auto 14px",
                  overflow: "hidden",
                  border: "2px solid var(--accent)",
                  background: "linear-gradient(135deg, rgba(13,148,136,.25), rgba(16,185,129,.25))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "2rem",
                }}
              >
                {r.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.photo_url} alt={r.student_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  "🎓"
                )}
              </div>
              <h3 style={{ fontSize: "1.1rem" }}>{r.student_name}</h3>
              {r.headline && <p className="grad" style={{ fontWeight: 800, marginTop: 4 }}>{r.headline}</p>}
              <p className="muted" style={{ fontSize: ".85rem", marginTop: 4 }}>
                {[r.attempt, r.marks].filter(Boolean).join(" · ")}
              </p>
              {r.quote && <p className="quote" style={{ marginTop: 10, fontSize: ".9rem" }}>&ldquo;{r.quote}&rdquo;</p>}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ textAlign: "center" }}>
          🎯 Results will be showcased here soon.
        </p>
      )}
    </section>
  );
}
