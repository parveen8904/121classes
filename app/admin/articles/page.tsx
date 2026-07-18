import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import DeleteButton from "../_components/DeleteButton";
import SubmitButton from "@/app/components/SubmitButton";
import { editArticle, toggleArticle, deleteArticle, addTopics, generateNow, deleteTopic } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Articles — Admin" };

export default async function AdminArticlesPage() {
  const svc = createServiceClient();
  // The list fetches the latest 100 (each row carries body_md for the inline
  // editor — fetching every body would weigh megabytes). The COUNT is exact.
  const [{ data: articles }, { data: topics }, { count: totalArticles }] = await Promise.all([
    svc.from("articles").select("id, slug, title, description, body_md, category, is_published, created_at").order("created_at", { ascending: false }).limit(100),
    svc.from("article_topics").select("id, topic, status").order("created_at").limit(200),
    svc.from("articles").select("id", { count: "exact", head: true }),
  ]);
  const pendingTopics = (topics ?? []).filter((t) => t.status === "pending");
  const total = totalArticles ?? (articles ?? []).length;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
      <AdminHero
        badge="📝 Articles & SEO"
        title="Study articles"
        subtitle="Original AI-written articles that bring Google traffic. Every article is public at /articles and in the sitemap — edit or unpublish anything, anytime. ✍️"
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* Queue status */}
      <div className="card" style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <strong>✍️ Writing queue: {pendingTopics.length} topic{pendingTopics.length === 1 ? "" : "s"} waiting · {total} article{total === 1 ? "" : "s"} written</strong>
          <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0" }}>
            The writer works through the queue automatically (and hourly as a safety net). Each article is original —
            never copied from the internet — and publishes itself to <Link href="/articles">/articles</Link>.
          </p>
        </div>
        {pendingTopics.length > 0 && (
          <form action={generateNow} style={{ margin: 0 }}>
            <SubmitButton className="btn small" savedLabel="✓ Writing…">▶ Write now</SubmitButton>
          </form>
        )}
      </div>

      {/* The full topic queue — grows every Monday from the trends scanner; automation never deletes. */}
      {pendingTopics.length > 0 && (
        <details className="card" style={{ marginTop: 12 }} open>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>📋 Topic list — waiting to be written ({pendingTopics.length})</summary>
          <p className="muted" style={{ fontSize: ".78rem", margin: "6px 0 8px" }}>
            New trending topics are added automatically every Monday (Ind AS / ICAI / NFRA / SEBI / SFIO / scams news).
            The scanner only ever ADDS — nothing is removed unless you remove it here.
          </p>
          <div style={{ display: "grid", gap: 4 }}>
            {pendingTopics.map((t) => (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, borderTop: "1px solid var(--border)", padding: "6px 0" }}>
                <span style={{ fontSize: ".85rem" }}>✍️ {t.topic}</span>
                <DeleteButton action={deleteTopic} id={t.id} message="Remove this topic from the queue?" />
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Add topics */}
      <details className="card" style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>➕ Add article topics (one per line)</summary>
        <form action={addTopics} style={{ marginTop: 10 }}>
          <textarea name="topics" rows={4} placeholder={"How to score exemption in FR\nInd AS 24 Related Party Disclosures explained"} />
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 8 }}>
            <div>
              <label>Category</label>
              <select name="category" defaultValue="strategy">
                <option value="fr">Financial Reporting (Final)</option>
                <option value="advanced-accounting">Advanced Accounting (Inter)</option>
                <option value="strategy">Study strategy</option>
                <option value="career">Exams & career</option>
                <option value="news">Accounting world / news</option>
              </select>
            </div>
            <SubmitButton className="btn small" savedLabel="✓ Queued">Add to queue</SubmitButton>
          </div>
        </form>
      </details>

      {/* Articles list */}
      <h2 className="admin-section-title" style={{ marginTop: 24 }}>📄 Written articles</h2>
      {total > (articles ?? []).length && (
        <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 10px" }}>
          Showing the latest {(articles ?? []).length} of <strong>{total}</strong> — every article (old and new) stays
          live on <Link href="/articles">/articles</Link> and in the Google sitemap.
        </p>
      )}
      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        {(articles ?? []).length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing written yet — press &ldquo;▶ Write now&rdquo; above to start the queue.</p></div>}
        {(articles ?? []).map((a) => (
          <div className="list-row" key={a.id} style={{ flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <span className="row-title">{a.is_published ? "🟢" : "⚪"} {a.title}</span>
              <p className="row-sub">
                /articles/{a.slug} · {a.category ?? "—"} · {new Date(a.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </p>
            </div>
            <div className="row-actions">
              <Link className="btn small secondary" href={`/articles/${a.slug}`} target="_blank">View</Link>
              <form action={toggleArticle} style={{ margin: 0 }}>
                <input type="hidden" name="id" value={a.id} />
                <button className="btn small secondary" type="submit">{a.is_published ? "Unpublish" : "Publish"}</button>
              </form>
              <DeleteButton action={deleteArticle} id={a.id} message="Delete this article permanently?" />
            </div>
            <details style={{ flexBasis: "100%", marginTop: 6 }}>
              <summary style={{ cursor: "pointer", fontSize: ".8rem", color: "var(--accent)" }}>✏️ Edit article</summary>
              <form action={editArticle} style={{ marginTop: 8, borderTop: "1px dashed var(--border)", paddingTop: 8 }}>
                <input type="hidden" name="id" value={a.id} />
                <label>Title</label>
                <input name="title" defaultValue={a.title} required />
                <label style={{ marginTop: 6 }}>Meta description</label>
                <input name="description" defaultValue={a.description ?? ""} />
                <label style={{ marginTop: 6 }}>Body (markdown)</label>
                <textarea name="body_md" rows={12} defaultValue={a.body_md} required style={{ fontFamily: "monospace", fontSize: ".82rem" }} />
                <SubmitButton className="btn small" savedLabel="✓ Saved" style={{ marginTop: 8 }}>Save article</SubmitButton>
              </form>
            </details>
          </div>
        ))}
      </div>
    </section>
  );
}
