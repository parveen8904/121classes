import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../_components/DeleteButton";
import AdminHero from "../_components/AdminHero";
import { getSecret } from "@/lib/secrets";
import { createAnnouncement, updateAnnouncement, deleteAnnouncement, saveGovtFeeds, fetchGovtFeedsNow } from "./actions";

const KINDS = [
  { value: "amendment", label: "Amendment" },
  { value: "whats_new", label: "What's new" },
  { value: "student_corner", label: "Student corner" },
  { value: "industry", label: "Industry" },
  { value: "macro", label: "Macro" },
];

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
              <label htmlFor="a-kind">Kind</label>
              <KindSelect name="kind" />
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
          <button className="btn" type="submit">
            Add announcement
          </button>
        </form>
      </div>

      <div style={{ marginTop: 24, display: "grid", gap: 12 }}>
        {items && items.length > 0 ? (
          items.map((a) => (
            <div className="card" key={a.id}>
              <form action={updateAnnouncement}>
                <input type="hidden" name="id" value={a.id} />
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 2fr" }}>
                  <div>
                    <label>Kind</label>
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
                  <button className="btn small" type="submit">
                    Save
                  </button>
                  <DeleteButton action={deleteAnnouncement} id={a.id} message="Delete this announcement?" />
                </div>
              </form>
            </div>
          ))
        ) : (
          <p className="muted">No announcements yet. Add the first one above.</p>
        )}
      </div>
    </section>
  );
}
