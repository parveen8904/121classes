import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AdminHero from "../_components/AdminHero";
import { getSecret } from "@/lib/secrets";
import { createAnnouncement, saveGovtFeeds, fetchGovtFeedsNow, saveFeedKeywords, sendDigestNow } from "./actions";
import SubmitButton from "@/app/components/SubmitButton";
import { ANNOUNCEMENT_KINDS as KINDS } from "@/lib/announcements";

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

export default async function AnnouncementsPage(
  props: {
    searchParams: Promise<{ feeds?: string; fetched?: string; digest?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const { data: rows } = await supabase.from("announcements").select("id, is_published");
  const total = (rows ?? []).length;
  const pendingCount = (rows ?? []).filter((i) => !i.is_published).length;
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
      {searchParams.fetched !== undefined && <div className="notice ok" style={{ marginTop: 16 }}>✅ Fetched {searchParams.fetched} new item(s) — see them under &ldquo;All posts&rdquo;, awaiting your approval.</div>}
      {searchParams.digest !== undefined && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          {Number(searchParams.digest) > 0 ? `✉️ Digest emailed with ${searchParams.digest} pending item(s).` : "No pending feed items to email right now."}
        </div>
      )}

      {/* Link to the full posts manager */}
      <Link href="/admin/announcements/posts" className="card" style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", textDecoration: "none" }}>
        <span><strong>📋 Manage all posts</strong> <span className="muted">— select, publish, categorise or remove ({total} total{pendingCount > 0 ? `, ${pendingCount} pending` : ""})</span></span>
        <span style={{ fontWeight: 800, color: "var(--accent)" }}>Open →</span>
      </Link>

      {/* AUTO-FEED — keyword driven */}
      <div className="form-card" style={{ marginTop: 18 }}>
        <h3>📰 Auto news feed (ICAI / NFRA / MCA / RBI / IFRS …)</h3>
        <p className="muted" style={{ fontSize: ".85rem", marginBottom: 10 }}>
          We search Google News for these <strong>keywords</strong> every hour, drop the noise, and save what&apos;s left as
          <strong> drafts</strong>. Once every <strong>24 hours</strong> you get a <strong>single email</strong> listing that
          day&apos;s finds, so you can approve from your phone. Nothing reaches students until you tick &ldquo;Published&rdquo;.
          {pendingCount > 0 && <strong> {pendingCount} item(s) awaiting approval.</strong>}
        </p>
        <form action={saveFeedKeywords}>
          <label htmlFor="kw">Keywords to watch (comma or new line)</label>
          <textarea id="kw" name="feed_keywords" rows={2} defaultValue={feedKeywords}
            placeholder="Ind AS, ICAI, NFRA, MCA, RBI, IFRS, IASB, IAS, Indian accounting standards" />
          <label htmlFor="noise" style={{ marginTop: 8 }}>Noise to ignore (exam results, toppers, vacancies …)</label>
          <textarea id="noise" name="feed_noise" rows={2} defaultValue={feedNoise}
            placeholder="topper, result, vacancy, admit card, congratulations" />
          <label htmlFor="digest" style={{ marginTop: 8 }}>Email the daily digest to</label>
          <input id="digest" name="feed_digest_email" type="email" defaultValue={feedDigestEmail} placeholder="you@example.com" />
          <button className="btn small" type="submit" style={{ marginTop: 8 }}>Save feed settings</button>
        </form>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <form action={fetchGovtFeedsNow}>
            <button className="btn small secondary" type="submit">⤵️ Fetch new items now</button>
          </form>
          <form action={sendDigestNow}>
            <button className="btn small secondary" type="submit">✉️ Email me the pending items now</button>
          </form>
        </div>
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
    </section>
  );
}
