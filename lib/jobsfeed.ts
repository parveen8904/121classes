import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { classifyJobs } from "@/lib/ai";

// Pull CA placement openings from job sources and file them as PENDING (status
// 'new') for the admin to categorise & approve. Sources:
//   - Jooble API (aggregates Naukri, Indeed, company sites…) — needs a free key.
//   - Any job RSS/Atom feed URLs the admin pastes (Google Jobs, firm careers).
// Deduped by URL. AI pre-classifies each into a placement category.

type Raw = { title: string; company: string; location: string; url: string; snippet: string; source: string; posted_at: string | null };

const DEFAULT_QUERIES = ["Chartered Accountant", "CA articleship", "CA Inter", "CA Final", "CA fresher", "articleship trainee", "statutory audit CA"];

// Keep ONLY Chartered-Accountant–domain roles. The aggregator mislabels every
// result's location with our search location, so we can't trust it; instead we
// require a CA / audit / tax signal IN THE TITLE, and exclude clearly foreign
// and non-CA (IT / sales / etc.) listings from the full text.
export function isCaRelevant(title: string, snippet?: string, company?: string): boolean {
  const titleL = title.toLowerCase();
  const full = `${title} ${snippet ?? ""} ${company ?? ""}`.toLowerCase();
  const titleCA = /chartered accountant|\barticle|\bicai\b|\bca[\s-]?inter\b|\bca[\s-]?final\b|\bca[\s-]?ipcc\b|semi[\s-]?qualified|qualified\s+ca\b|\bca\b|\baudit|\bauditor\b|taxation|\btax\b|statutory|assurance|cost account|\bcma\b/;
  const foreign = /united states|\busa\b|u\.s\.|us tax|us gaap|\bamerica\b|\bcanada\b|united kingdom|\buk\b|\bdubai\b|\buae\b|singapore|australia|\bafrica\b|nigeria|kenya|philippines|malaysia|qatar|saudi|\b(mn|tx|ny|nj|fl|il|wa|oh|pa)\b/;
  const nonCa = /software|web\s?developer|app developer|\bdeveloper\b|programmer|\bengineer\b|devops|front[\s-]?end|back[\s-]?end|full[\s-]?stack|\bjava\b|javascript|python|react|node\.?js|\.net|data scien|machine learning|\bqa\b|tester|ui\/ux|graphic|web designer|\bsales\b|marketing|\bbpo\b|telecall|customer (support|care)|\bnurse\b|\bdoctor\b|teacher|\bdriver\b|electric|mechanic|civil eng|recruit|organi[sz]er|\bunion\b|casino|\bbanker\b|paraplanner|merchandiser|warehouse|delivery|public policy|financial analyst/;
  return titleCA.test(titleL) && !foreign.test(full) && !nonCa.test(full);
}

async function queryList(): Promise<string[]> {
  const raw = await getSecret("JOB_QUERIES");
  return (raw ? raw.split(/[\n,]/).map((q) => q.trim()).filter(Boolean) : DEFAULT_QUERIES);
}

// "3 days ago" / "30+ days ago" → an ISO date (best effort).
function parseRelative(s: string): string | null {
  const m = s.toLowerCase().match(/(\d+)\+?\s*(hour|day|week|month)/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const ms = unit === "hour" ? 3600e3 : unit === "day" ? 864e5 : unit === "week" ? 7 * 864e5 : 30 * 864e5;
  return new Date(Date.now() - n * ms).toISOString();
}

// Google Jobs via SerpAPI — real listings with CORRECT locations (paid key).
async function fromSerpApi(): Promise<Raw[]> {
  const key = await getSecret("SERPAPI_KEY");
  if (!key) return [];
  const queries = (await queryList()).slice(0, 6);
  const locRaw = (await getSecret("JOB_LOCATION")) || "India";
  const locations = locRaw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  if (!locations.length) locations.push("India");
  const combos: { q: string; loc: string }[] = [];
  for (const q of queries) for (const loc of locations) combos.push({ q, loc });
  const out: Raw[] = [];
  for (const { q, loc } of combos.slice(0, 12)) {
    const location = /india/i.test(loc) ? loc : `${loc}, India`;
    const u = `https://serpapi.com/search.json?engine=google_jobs&q=${encodeURIComponent(q)}&location=${encodeURIComponent(location)}&hl=en&gl=in&api_key=${key}`;
    try {
      const res = await fetch(u, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      for (const j of (data.jobs_results ?? []).slice(0, 15)) {
        const apply = Array.isArray(j.apply_options) && j.apply_options[0]?.link ? String(j.apply_options[0].link) : (j.share_link ? String(j.share_link) : "");
        if (!j.title || !apply) continue;
        const posted = j.detected_extensions?.posted_at ? parseRelative(String(j.detected_extensions.posted_at)) : null;
        out.push({
          title: String(j.title).slice(0, 280),
          company: String(j.company_name ?? "").slice(0, 160),
          location: String(j.location ?? "").slice(0, 160),
          url: apply,
          snippet: String(j.description ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
          source: String(j.via ?? "Google Jobs").replace(/^via\s+/i, "").slice(0, 80),
          posted_at: posted,
        });
      }
    } catch {
      // skip
    }
  }
  return out;
}

async function fromJooble(): Promise<Raw[]> {
  const key = await getSecret("JOOBLE_API_KEY");
  if (!key) return [];
  const queries = (await queryList()).slice(0, 6);
  const locRaw = (await getSecret("JOB_LOCATION")) || "India";
  const locations = locRaw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  if (!locations.length) locations.push("India");
  const pages = Math.min(3, Math.max(1, Number(await getSecret("JOB_PAGES")) || 2));
  // Each keyword × each city × pages, capped so we don't hammer the free API.
  const combos: { keywords: string; location: string; page: number }[] = [];
  for (const keywords of queries) for (const location of locations) for (let page = 1; page <= pages; page++) combos.push({ keywords, location, page });
  const out: Raw[] = [];
  for (const { keywords, location, page } of combos.slice(0, 40)) {
    try {
      const res = await fetch(`https://jooble.org/api/${key}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keywords, location, page }),
        cache: "no-store",
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const j of (data.jobs ?? []).slice(0, 40)) {
        if (!j.title || !j.link) continue;
        out.push({
          title: String(j.title).slice(0, 280),
          company: String(j.company ?? "").slice(0, 160),
          location: String(j.location ?? "").slice(0, 160),
          url: String(j.link),
          snippet: String(j.snippet ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500),
          source: String(j.source ?? "Jooble").slice(0, 80),
          posted_at: j.updated ? String(j.updated) : null,
        });
      }
    } catch {
      // skip this query
    }
  }
  return out;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}
function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decode(m[1]) : "";
}

async function fromRss(): Promise<Raw[]> {
  const raw = await getSecret("JOB_FEEDS");
  const urls = raw.split(/[\n,]/).map((u) => u.trim()).filter(Boolean);
  const out: Raw[] = [];
  for (const url of urls) {
    let xml = "";
    try {
      xml = await fetch(url, { cache: "no-store", headers: { "User-Agent": "121CAClasses-JobBot" } }).then((r) => r.text());
    } catch {
      continue;
    }
    const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) ?? [];
    for (const block of blocks.slice(0, 25)) {
      const title = pick(block, "title");
      let link = pick(block, "link");
      if (!link) {
        const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
        if (href) link = href[1].trim();
      }
      if (!title || !link) continue;
      out.push({
        title: title.slice(0, 280),
        company: "",
        location: "",
        url: link,
        snippet: (pick(block, "description") || pick(block, "summary")).slice(0, 500),
        source: (() => { try { return new URL(url).hostname; } catch { return "feed"; } })(),
        posted_at: pick(block, "pubDate") || pick(block, "published") || pick(block, "updated") || null,
      });
    }
  }
  return out;
}

type DigestItem = { title: string; company: string; category: string; url: string };
export async function ingestJobs(): Promise<{ added: number; checked: number; items: DigestItem[] }> {
  const svc = createServiceClient();
  // Prefer Google Jobs (SerpAPI) when configured — real listings, correct
  // locations. Fall back to Jooble only if SerpAPI isn't set up. RSS always.
  const serp = await fromSerpApi();
  const primary = serp.length || (await getSecret("SERPAPI_KEY")) ? serp : await fromJooble();
  const all = [...primary, ...(await fromRss())];
  if (!all.length) return { added: 0, checked: 0, items: [] as DigestItem[] };

  // Dedupe within this run + keep only genuine CA / articleship roles.
  const seen = new Set<string>();
  const unique = all
    .filter((j) => (seen.has(j.url) ? false : (seen.add(j.url), true)))
    .filter((j) => isCaRelevant(j.title, j.snippet, j.company));
  const fresh: Raw[] = [];
  for (const j of unique) {
    const { data: existing } = await svc.from("job_listings").select("id").eq("url", j.url).maybeSingle();
    if (!existing) fresh.push(j);
  }
  if (!fresh.length) return { added: 0, checked: unique.length, items: [] as DigestItem[] };

  const autoPublish = (await getSecret("JOB_AUTOPUBLISH")) === "1";
  const cats = await classifyJobs(fresh.map((j) => ({ title: j.title, company: j.company, snippet: j.snippet })));
  const items: { title: string; company: string; category: string; url: string }[] = [];
  for (let i = 0; i < fresh.length; i++) {
    const j = fresh[i];
    const category = cats[i] || "Other";
    const posted = j.posted_at && !isNaN(Date.parse(j.posted_at)) ? new Date(j.posted_at).toISOString() : null;
    const { error } = await svc.from("job_listings").insert({
      source: j.source,
      title: j.title,
      company: j.company || null,
      location: j.location || null,
      url: j.url,
      snippet: j.snippet || null,
      category,
      posted_at: posted,
      status: autoPublish ? "approved" : "new",
    });
    if (!error) items.push({ title: j.title, company: j.company, category, url: j.url });
  }
  return { added: items.length, checked: unique.length, items };
}

// Email the admin a digest of newly-pulled openings (used by the daily cron).
export async function sendPlacementDigest(items: { title: string; company: string; category: string; url: string }[]) {
  if (!items.length) return;
  const to = await getSecret("PLACEMENT_DIGEST_EMAIL");
  if (!to) return;
  const rows = items
    .slice(0, 50)
    .map((j) => `<li><strong>${j.title}</strong>${j.company ? ` — ${j.company}` : ""} <em>(${j.category})</em> — <a href="${j.url}">view</a></li>`)
    .join("");
  const { sendEmail } = await import("@/lib/notify");
  await sendEmail(
    to,
    `🎓 ${items.length} new CA opening(s) to review`,
    `<p>${items.length} new opening(s) were pulled in. Approve the ones you want in <strong>Admin → Student placement</strong>.</p><ul>${rows}</ul>`,
  );
}
