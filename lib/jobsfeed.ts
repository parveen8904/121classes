import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { classifyJobs } from "@/lib/ai";

// Pull CA placement openings from job sources and file them as PENDING (status
// 'new') for the admin to categorise & approve. Sources:
//   - Jooble API (aggregates Naukri, Indeed, company sites…) — needs a free key.
//   - Any job RSS/Atom feed URLs the admin pastes (Google Jobs, firm careers).
// Deduped by URL. AI pre-classifies each into a placement category.

type Raw = { title: string; company: string; location: string; url: string; snippet: string; source: string };

const DEFAULT_QUERIES = ["Chartered Accountant", "CA articleship", "CA Inter", "CA fresher", "audit associate"];

async function fromJooble(): Promise<Raw[]> {
  const key = await getSecret("JOOBLE_API_KEY");
  if (!key) return [];
  const queriesRaw = await getSecret("JOB_QUERIES");
  const queries = (queriesRaw ? queriesRaw.split(/[\n,]/).map((q) => q.trim()).filter(Boolean) : DEFAULT_QUERIES).slice(0, 6);
  const location = (await getSecret("JOB_LOCATION")) || "India";
  const out: Raw[] = [];
  for (const keywords of queries) {
    try {
      const res = await fetch(`https://jooble.org/api/${key}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keywords, location }),
        cache: "no-store",
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const j of (data.jobs ?? []).slice(0, 20)) {
        if (!j.title || !j.link) continue;
        out.push({
          title: String(j.title).slice(0, 280),
          company: String(j.company ?? "").slice(0, 160),
          location: String(j.location ?? "").slice(0, 160),
          url: String(j.link),
          snippet: String(j.snippet ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500),
          source: String(j.source ?? "Jooble").slice(0, 80),
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
      });
    }
  }
  return out;
}

export async function ingestJobs(): Promise<{ added: number; checked: number }> {
  const svc = createServiceClient();
  const all = [...(await fromJooble()), ...(await fromRss())];
  if (!all.length) return { added: 0, checked: 0 };

  // Dedupe within this run, then against what's already stored.
  const seen = new Set<string>();
  const unique = all.filter((j) => (seen.has(j.url) ? false : (seen.add(j.url), true)));
  const fresh: Raw[] = [];
  for (const j of unique) {
    const { data: existing } = await svc.from("job_listings").select("id").eq("url", j.url).maybeSingle();
    if (!existing) fresh.push(j);
  }
  if (!fresh.length) return { added: 0, checked: unique.length };

  const cats = await classifyJobs(fresh.map((j) => ({ title: j.title, company: j.company, snippet: j.snippet })));
  let added = 0;
  for (let i = 0; i < fresh.length; i++) {
    const j = fresh[i];
    const { error } = await svc.from("job_listings").insert({
      source: j.source,
      title: j.title,
      company: j.company || null,
      location: j.location || null,
      url: j.url,
      snippet: j.snippet || null,
      category: cats[i] || "Other",
      status: "new",
    });
    if (!error) added++;
  }
  return { added, checked: unique.length };
}
