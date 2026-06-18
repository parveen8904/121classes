import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";

// Pull new items from government/ICAI RSS or Atom feeds and file them as PENDING
// announcements (is_published = false) for faculty approval. Deduped by link.

type FeedItem = { title: string; link: string; body: string };

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

function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) ?? [];
  for (const block of blocks) {
    const title = pick(block, "title");
    // RSS <link>url</link> or Atom <link href="url"/>
    let link = pick(block, "link");
    if (!link) {
      const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      if (href) link = href[1].trim();
    }
    const body = pick(block, "description") || pick(block, "summary") || pick(block, "content");
    if (title && link) items.push({ title, link, body: body.slice(0, 600) });
  }
  return items;
}

// Fetch all configured feeds; insert new items as pending announcements.
export async function ingestGovtFeeds(): Promise<{ added: number; checked: number }> {
  const raw = await getSecret("GOVT_FEEDS"); // newline-separated feed URLs
  const urls = raw.split(/[\n,]/).map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) return { added: 0, checked: 0 };

  const svc = createServiceClient();
  let added = 0;
  let checked = 0;

  for (const url of urls) {
    let xml = "";
    try {
      xml = await fetch(url, { cache: "no-store", headers: { "User-Agent": "121CAClasses-FeedBot" } }).then((r) => r.text());
    } catch {
      continue;
    }
    const items = parseFeed(xml).slice(0, 20);
    for (const it of items) {
      checked++;
      // dedupe by link
      const { data: existing } = await svc
        .from("announcements")
        .select("id")
        .eq("link_url", it.link)
        .maybeSingle();
      if (existing) continue;
      const { error } = await svc.from("announcements").insert({
        kind: "amendment",
        title: it.title.slice(0, 280),
        body: it.body || null,
        link_url: it.link,
        is_published: false, // pending faculty approval
      });
      if (!error) added++;
    }
  }
  return { added, checked };
}
