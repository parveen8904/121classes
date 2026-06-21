import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../_components/DeleteButton";
import AdminHero from "../_components/AdminHero";
import { getSecret } from "@/lib/secrets";
import { createAnnouncement, updateAnnouncement, deleteAnnouncement, saveGovtFeeds, fetchGovtFeedsNow } from "./actions";
import SubmitButton from "@/app/components/SubmitButton";
import { ANNOUNCEMENT_KINDS as KINDS, ANNOUNCEMENT_KIND_LABEL as KIND_LABEL } from "@/lib/announcements";

function KindSelect({ name, value }: { name: string; value?: string }) {
  return (
    <select name={name} defaultValue={value ?? "whats_new"}>
      {KINDS.map((k) => (
        <option key={k.value} value={k.value}>
          {k.label}
        </option>
      ))}
    </select>
  );
}

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: { feeds?: string; fetched?: string };
}) {
  const supabase = createClient();
  const { data: items } = await supabase
    .from("announcements")
    .select("id, kind, title, body, link_url, is_published, published_at")
    .order("published_at", { ascending: false });
  const pendingCount = (items ?? []).filter((i) => !i.is_published).length;
  const govtFeeds = await getSecret("GOVT_FEEDS");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📣 Announcements"
        title="Announcements"
        subtitle="Amendments, what's new, student corner, industry & macro updates. 📰"
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.feeds === "saved" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Feed sources saved.</div>}
      {searchParams.fetched !== undefined && <div className="notice ok" style={{ marginTop: 16 }}>✅ Fetched {searchParams.fetched} new item(s) — they&apos;re below as unpublished, awaiting your approval.</div>}

      {/* GOVT / ICAI AUTO-FEED */}
      <div className="form-card" style={{ marginTop: 18 }}>
        <h3>🏛️ Government / ICAI auto-feed</h3>
        <p className="muted" style={{ fontSize: ".85rem", marginBottom: 10 }}>
          Paste <strong>RSS/Atom feed URLs</strong> (one per line) from ICAI / government sites. New items are pulled
          automatically and appear below as <strong>unpublished</strong> — they only go live when you tick
          &ldquo;Published&rdquo; (your approval). {pendingCount > 0 && <strong>{pendingCount} item(s) awaiting approval.</strong>}
        </p>
        <form action={saveGovtFeeds}>
          <textarea name="govt_feeds" rows={3} defaultValue={govtFeeds}
            placeholder={"https://icai.org/…/rss\nhttps://incometax.gov.in/…/feed"} />
          <button className="btn small" type="submit" style={{ marginTop: 8 }}>Save feed sources</button>
        </form>
        <form action={fetchGovtFeedsNow} style={{ marginTop: 8 }}>
          <button className="btn small secondary" type="submit">⤵️ Fetch new items now</button>
        </form>
      </div>

      <div className="form-card" style={{ marginTop: 24 }}>
        <h3>➕ Add an announcement</h3>
        <form action={createAnnouncement}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 2fr" }}>
            <div>
              <label htmlFor="a-kind">Category</label>
              <KindSelect name="kind" />
              <p className="muted" style={{ fontSize: ".78rem", margin: "4px 0 0" }}>Students see this as a labelled badge (Update / Industry / Macro / Amendment …).</p>
            </div>
            <div>
              <label htmlFor="a-title">Title</label>
              <input id="a-title" name="title" placeholder="Headline" required />
            </div>
          </div>
          <label htmlFor="a-body">Body (optional)</label>
          <textarea id="a-body" name="body" rows={3} placeholder="Details" />
          <label htmlFor="a-link">Link URL (optional)</label>
          <input id="a-link" name="link_url" placeholder="https://…" />
          <label className="remember" style={{ marginTop: 0 }}>
            <input type="checkbox" name="is_published" defaultChecked /> Published
          </label>
          <SubmitButton className="btn" savedLabel="✓ Added">Add announcement</SubmitButton>
        </form>
      </div>

      <h2 className="admin-section-title">📋 All announcements ({(items ?? []).length})</h2>
      <p className="muted" style={{ fontSize: ".9rem" }}>Tap one to open and edit it; it collapses again after you save.</p>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {items && items.length > 0 ? (
          items.map((a) => (
            <details className="card" key={a.id}>
              <summary style={{ cursor: "pointer", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <strong>{a.title}</strong>
                <span className="muted" style={{ fontSize: ".82rem" }}>
                  {KIND_LABEL[a.kind] ?? a.kind} · {a.is_published ? "🟢 published" : "⚪ draft"}
                </span>
              </summary>
              <form action={updateAnnouncement} style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={a.id} />
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 2fr" }}>
                  <div>
                    <label>Category</label>
                    <KindSelect name="kind" value={a.kind} />
                  </div>
                  <div>
                    <label>Title</label>
                    <input name="title" defaultValue={a.title} required />
                  </div>
                </div>
                <label>Body</label>
                <textarea name="body" rows={3} defaultValue={a.body ?? ""} />
                <label>Link URL</label>
                <input name="link_url" defaultValue={a.link_url ?? ""} />
                <label className="remember" style={{ marginTop: 0 }}>
                  <input type="checkbox" name="is_published" defaultChecked={a.is_published} /> Published
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <SubmitButton className="btn small" closeDetails>Save</SubmitButton>
                  <DeleteButton action={deleteAnnouncement} id={a.id} message="Delete this announcement?" />
                </div>
              </form>
            </details>
          ))
        ) : (
          <p className="muted">No announcements yet. Add the first one above.</p>
        )}
      </div>
    </section>
  );
}
