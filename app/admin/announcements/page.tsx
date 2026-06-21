import { createClient } from "@/lib/supabase/server";
import DeleteButton from "../_components/DeleteButton";
import AdminHero from "../_components/AdminHero";
import { getSecret } from "@/lib/secrets";
import { createAnnouncement, updateAnnouncement, deleteAnnouncement, saveGovtFeeds, fetchGovtFeedsNow, saveFeedKeywords, broadcastAnnouncement } from "./actions";
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
  searchParams: { feeds?: string; fetched?: string; bcast?: string };
}) {
  const supabase = createClient();
  const { data: items } = await supabase
    .from("announcements")
    .select("id, kind, title, body, link_url, is_published, published_at, broadcast_at")
    .order("published_at", { ascending: false });
  const pendingCount = (items ?? []).filter((i) => !i.is_published).length;
  const govtFeeds = await getSecret("GOVT_FEEDS");
  const feedKeywords = await getSecret("FEED_KEYWORDS");
  const feedNoise = await getSecret("FEED_NOISE");
  const feedDigestEmail = await getSecret("FEED_DIGEST_EMAIL");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📣 Announcements"
        title="Announcements"
        subtitle="Amendments, what's new, student corner, industry & macro updates. 📰"
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.feeds === "saved" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Feed settings saved.</div>}
      {searchParams.fetched !== undefined && <div className="notice ok" style={{ marginTop: 16 }}>✅ Fetched {searchParams.fetched} new item(s) — they&apos;re below as unpublished, awaiting your approval.</div>}
      {searchParams.bcast === "sent" && <div className="notice ok" style={{ marginTop: 16 }}>📢 Broadcast sent to the Telegram channel + queued for the mobile app.</div>}
      {searchParams.bcast === "queued" && <div className="notice ok" style={{ marginTop: 16 }}>📢 Queued for the mobile app. (Telegram not configured, so nothing sent there yet.)</div>}
      {searchParams.bcast === "unpublished" && <div className="notice" style={{ marginTop: 16 }}>⚠️ Publish the announcement first, then broadcast it.</div>}

      {/* AUTO-FEED — keyword driven */}
      <div className="form-card" style={{ marginTop: 18 }}>
        <h3>📰 Auto news feed (ICAI / NFRA / MCA / RBI / IFRS …)</h3>
        <p className="muted" style={{ fontSize: ".85rem", marginBottom: 10 }}>
          Every hour we search Google News for these <strong>keywords</strong>, drop the noise, save what&apos;s left as
          <strong> drafts</strong>, and <strong>email you a digest</strong> so you can approve from your phone. Nothing
          reaches students until you tick &ldquo;Published&rdquo;. {pendingCount > 0 && <strong>{pendingCount} item(s) awaiting your approval below.</strong>}
        </p>
        <form action={saveFeedKeywords}>
          <label htmlFor="kw">Keywords to watch (comma or new line)</label>
          <textarea id="kw" name="feed_keywords" rows={2} defaultValue={feedKeywords}
            placeholder="Ind AS, ICAI, NFRA, MCA, RBI, IFRS, IASB, IAS, Indian accounting standards" />
          <label htmlFor="noise" style={{ marginTop: 8 }}>Noise to ignore (exam results, toppers, vacancies …)</label>
          <textarea id="noise" name="feed_noise" rows={2} defaultValue={feedNoise}
            placeholder="topper, result, vacancy, admit card, congratulations" />
          <label htmlFor="digest" style={{ marginTop: 8 }}>Email the hourly digest to</label>
          <input id="digest" name="feed_digest_email" type="email" defaultValue={feedDigestEmail} placeholder="you@example.com" />
          <button className="btn small" type="submit" style={{ marginTop: 8 }}>Save feed settings</button>
        </form>
        <form action={fetchGovtFeedsNow} style={{ marginTop: 8 }}>
          <button className="btn small secondary" type="submit">⤵️ Fetch new items now</button>
        </form>
        <details style={{ marginTop: 10 }}>
          <summary className="muted" style={{ fontSize: ".82rem", cursor: "pointer" }}>Extra feed URLs (optional)</summary>
          <form action={saveGovtFeeds} style={{ marginTop: 8 }}>
            <textarea name="govt_feeds" rows={2} defaultValue={govtFeeds}
              placeholder={"https://example.org/…/rss"} />
            <button className="btn small" type="submit" style={{ marginTop: 8 }}>Save extra feeds</button>
          </form>
        </details>
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
                  {a.broadcast_at ? " · 📢 broadcast" : ""}
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
              {/* Broadcast to students — separate form (can't nest forms). */}
              <form action={broadcastAnnouncement} style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <input type="hidden" name="id" value={a.id} />
                <SubmitButton className="btn small secondary" savedLabel="📢 Sent">
                  {a.broadcast_at ? "📢 Broadcast again to students" : "📢 Send to students (mobile + Telegram)"}
                </SubmitButton>
                <p className="muted" style={{ fontSize: ".76rem", margin: "6px 0 0" }}>
                  {a.broadcast_at
                    ? `Last broadcast ${new Date(a.broadcast_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`
                    : "Posts to the Telegram channel now and queues a push for the mobile app. Publish it first."}
                </p>
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
