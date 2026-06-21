import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { sendEmail, emailShell } from "@/lib/notify";
import { ANNOUNCEMENT_KIND_LABEL } from "@/lib/announcements";

// Pull new items from Google-News / RSS / Atom feeds and file them as PENDING
// announcements (is_published = false) for faculty approval. Deduped by link.
// The feeds are built automatically from the keyword list (FEED_KEYWORDS) the
// founder controls in Admin → Announcements; obvious noise (exam results,
// toppers, vacancies …) is dropped via FEED_NOISE before anything is saved.

export type FeedItem = { title: string; link: string; body: string; kind: string };

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decode(m[1]) : "";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- keyword → Google News feed URLs --------------------------------------
const CTX_IN =
  '(amendment OR notification OR circular OR rule OR "accounting standard" OR "exposure draft" OR "guidance note")';
const CTX_GLOBAL = '(amendment OR "new standard" OR "exposure draft" OR update)';

function gnews(q: string, hl: string, gl: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${gl}:${hl.split("-")[0]}`;
}

function buildKeywordFeeds(csv: string): string[] {
  const kws = csv.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  if (kws.length === 0) return [];
  const orGroup = kws.map((k) => (k.includes(" ") ? `"${k}"` : k)).join(" OR ");
  return [
    gnews(`(${orGroup}) ${CTX_IN}`, "en-IN", "IN"),         // India regulators / standards
    gnews(`(IFRS OR IASB OR IAS) ${CTX_GLOBAL}`, "en", "US"), // global standard-setters
  ];
}

// Suggest a category from the headline so the draft lands pre-tagged; the
// founder can still change it from the dropdown before publishing.
export function guessCategory(title: string): string {
  const t = title.toLowerCase();
  if (/(exam|result|syllabus|student|ca inter|ca final|ca foundation|registration|attempt|mock|admit|study material)/.test(t)) return "student_corner";
  if (/(rbi|repo rate|inflation|gdp|economy|budget|monetary|fiscal|gst collection|forex|rupee)/.test(t)) return "macro";
  if (/(ind as|ifrs|ias |iasb|accounting standard|exposure draft|guidance note|amendment|nfra|icai|mca|notification|companies act)/.test(t)) return "amendment";
  return "industry";
}

function parseFeed(xml: string, noise: string[]): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) ?? [];
  for (const block of blocks) {
    const title = pick(block, "title");
    let link = pick(block, "link");
    if (!link) {
      const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (href) link = href[1].trim();
    }
    if (!title || !link) continue;
    const lc = title.toLowerCase();
    if (noise.some((n) => n && lc.includes(n))) continue; // drop obvious noise
    const body = pick(block, "description") || pick(block, "summary") || pick(block, "content");
    items.push({ title, link, body: body.slice(0, 600), kind: guessCategory(title) });
  }
  return items;
}

// Fetch all keyword feeds (+ any manual extras in GOVT_FEEDS); insert new items
// as pending announcements. Returns the rows it actually added this run so the
// caller can email a digest.
export async function ingestGovtFeeds(): Promise<{ added: number; checked: number; items: FeedItem[] }> {
  const keywords = await getSecret("FEED_KEYWORDS");
  const extra = await getSecret("GOVT_FEEDS"); // optional manual feed URLs
  const noise = (await getSecret("FEED_NOISE")).split(/[\n,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);

  const urls = [
    ...buildKeywordFeeds(keywords),
    ...extra.split(/[\n,]/).map((u) => u.trim()).filter(Boolean),
  ];
  if (urls.length === 0) return { added: 0, checked: 0, items: [] };

  const svc = createServiceClient();
  const added: FeedItem[] = [];
  let checked = 0;

  for (const url of urls) {
    let xml = "";
    try {
      xml = await fetch(url, { cache: "no-store", headers: { "User-Agent": "121CAClasses-FeedBot" } }).then((r) => r.text());
    } catch {
      continue;
    }
    const items = parseFeed(xml, noise).slice(0, 20);
    for (const it of items) {
      checked++;
      const { data: existing } = await svc
        .from("announcements")
        .select("id")
        .eq("link_url", it.link)
        .maybeSingle();
      if (existing) continue;
      const { error } = await svc.from("announcements").insert({
        kind: it.kind,
        title: it.title.slice(0, 280),
        body: it.body || null,
        link_url: it.link,
        is_published: false, // pending faculty approval
      });
      if (!error) added.push(it);
    }
  }
  return { added: added.length, checked, items: added };
}

// Email the founder a digest of the items found this run, so he can approve
// from his phone. No-op when nothing new was found.
export async function sendFeedDigest(items: FeedItem[]): Promise<void> {
  if (items.length === 0) return;
  const to = (await getSecret("FEED_DIGEST_EMAIL")) || (await getSecret("FACULTY_EMAIL")) || "mail@caparveensharma.com";
  if (!to) return;

  const rows = items
    .map(
      (it) => `
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin:10px 0">
      <span style="display:inline-block;background:#0d9488;color:#fff;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px">${ANNOUNCEMENT_KIND_LABEL[it.kind] ?? "Update"}</span>
      <div style="font-weight:700;margin:7px 0 4px;font-size:15px">${escapeHtml(it.title)}</div>
      ${it.body ? `<div style="font-size:13px;color:#475569;line-height:1.5">${escapeHtml(it.body.slice(0, 220))}…</div>` : ""}
      <a href="${escapeHtml(it.link)}" style="font-size:12px;color:#0d9488;font-weight:700">Read source →</a>
    </div>`,
    )
    .join("");

  const cta = `<a href="https://caparveensharma.com/admin/announcements" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px;margin-top:6px">Review &amp; approve on your phone →</a>`;

  const n = items.length;
  const html = emailShell(
    `🆕 ${n} new CA update${n > 1 ? "s" : ""} to review`,
    `<p>New regulatory / accounting-standards news was found and saved as <strong>drafts</strong> (a suggested category is shown on each). Nothing is visible to students until you approve it.</p>${rows}<p style="margin-top:16px">${cta}</p>`,
  );
  await sendEmail(to, `🆕 ${n} CA update${n > 1 ? "s" : ""} to review — 121 CA Classes`, html);
}
