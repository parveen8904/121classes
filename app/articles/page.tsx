import Link from "next/link";
import { tryServiceClient } from "@/lib/supabase/service";

// Public SEO surface — cached and regenerated hourly.
export const revalidate = 3600;
export const metadata = {
  title: "Free CA Study Articles & Notes — CA Parveen Sharma",
  description: "Free articles for CA students — Ind AS & AS explained, Advanced Accounting chapters, study plans, revision strategy and exam tips by CA Parveen Sharma.",
  alternates: { canonical: "/articles" },
};

const CAT_LABEL: Record<string, string> = {
  fr: "📘 Financial Reporting (CA Final)",
  "advanced-accounting": "📗 Advanced Accounting (CA Inter)",
  strategy: "🎯 Study strategy",
  career: "🧭 Exams & career",
};
const CAT_ORDER = ["fr", "advanced-accounting", "strategy", "career"];

export default async function ArticlesIndex() {
  const svc = tryServiceClient();
  const { data } = svc
    ? await svc
        .from("articles")
        .select("slug, title, description, category, created_at")
        .eq("is_published", true)
        .order("created_at", { ascending: false })
        .limit(200)
    : { data: [] };
  const articles = data ?? [];
  const byCat = new Map<string, typeof articles>();
  for (const a of articles) {
    const k = (a.category as string) || "strategy";
    byCat.set(k, [...(byCat.get(k) ?? []), a]);
  }

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
        <span className="badge">📚 Free study articles</span>
        <h1 style={{ marginTop: 10 }}>CA study articles &amp; notes</h1>
        <p className="meta" style={{ marginTop: 8 }}>
          Free, exam-focused reading for CA students — accounting standards explained simply, chapter approaches,
          and study strategy. From the classroom of CA Parveen Sharma (36 years of teaching).
        </p>

        {articles.length === 0 && (
          <div className="card" style={{ marginTop: 18 }}>
            <p className="muted" style={{ margin: 0 }}>Articles are being prepared — check back shortly. Meanwhile, <Link href="/free-planner?src=articles">build your free study plan →</Link></p>
          </div>
        )}

        {CAT_ORDER.filter((c) => byCat.has(c)).map((cat) => (
          <div key={cat}>
            <h2 className="admin-section-title" style={{ marginTop: 26 }}>{CAT_LABEL[cat] ?? cat}</h2>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {(byCat.get(cat) ?? []).map((a) => (
                <Link key={a.slug} href={`/articles/${a.slug}`} className="list-row" style={{ textDecoration: "none", color: "inherit" }}>
                  <div>
                    <span className="row-title">{a.title}</span>
                    {a.description && <p className="row-sub">{a.description}</p>}
                  </div>
                  <span className="btn small secondary">Read →</span>
                </Link>
              ))}
            </div>
          </div>
        ))}

        <div className="card" style={{ marginTop: 30, textAlign: "center" }}>
          <h3 style={{ marginTop: 0 }}>Turn reading into a plan</h3>
          <p className="muted" style={{ fontSize: ".9rem" }}>Get a free day-by-day study plan for your attempt — takes 2 minutes.</p>
          <Link className="btn" href="/free-planner?src=articles">📅 Build my free plan →</Link>
        </div>
      </section>
    </main>
  );
}
