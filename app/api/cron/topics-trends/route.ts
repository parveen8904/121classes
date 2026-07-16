import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { proposeTrendingTopics } from "@/lib/ai";
import { sendEmail, emailShell } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Weekly (Monday morning): scan the accounting world's news — Ind AS/standards,
// ICAI, NFRA, SEBI accounting matters, SFIO/CBI fraud probes, forensic
// accounting, scams — and ADD fresh article topics to the writer's queue.
// Never deletes anything; only adds. The founder asked for exactly this:
// "revised every week based on current trend, source can be industry, NFRA,
// SFIO, scams, CBI and of course ICAI".

const QUERIES = [
  '"Ind AS" OR "Indian Accounting Standards" OR "accounting standard" India',
  "NFRA order OR NFRA penalty OR NFRA audit",
  "SEBI accounting OR SEBI financial statements OR SEBI audit disclosure",
  '"SFIO" OR "Serious Fraud Investigation Office"',
  "accounting scam OR audit fraud OR financial fraud company India",
  "forensic accounting OR forensic audit India",
  "ICAI announcement OR ICAI CA students",
  "CBI bank fraud OR CBI accounting fraud",
];

function gnewsUrl(q: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:7d")}&hl=en-IN&gl=IN&ceid=IN:en`;
}

// Titles only — enough for topic mining. (Google News titles end with " - Source".)
function titlesFromRss(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g)) {
    const t = m[1].replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
    if (t.length > 20) out.push(t);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok =
      req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 1) This week's accounting-world headlines.
  const results = await Promise.all(QUERIES.map(async (q) => {
    try {
      const res = await fetch(gnewsUrl(q), { cache: "no-store", headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) return [] as string[];
      return titlesFromRss(await res.text()).slice(0, 8);
    } catch { return [] as string[]; }
  }));
  const headlines = [...new Set(results.flat())];
  if (headlines.length < 3) return NextResponse.json({ ok: false, note: "too few headlines this week" });

  // 2) What's already queued/written (never duplicate).
  const svc = createServiceClient();
  const [{ data: topics }, { data: arts }] = await Promise.all([
    svc.from("article_topics").select("topic").order("created_at", { ascending: false }).limit(150),
    svc.from("articles").select("title").order("created_at", { ascending: false }).limit(100),
  ]);
  const existing = [
    ...(topics ?? []).map((t) => String(t.topic)),
    ...(arts ?? []).map((a) => String(a.title)),
  ];

  // 3) AI mines the headlines for new student-angle topics.
  const fresh = await proposeTrendingTopics(headlines, existing);
  if (!fresh?.length) return NextResponse.json({ ok: false, note: "AI unavailable or nothing new" });

  await svc.from("article_topics").insert(fresh.map((t) => ({ topic: t.topic, category: t.category, keywords: t.keywords })));

  // 4) Tell the admins what was added (the writer picks them up automatically).
  const { data: admins } = await svc.from("profiles").select("email").eq("role", "admin").not("email", "is", null).limit(5);
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const html = emailShell("📰 This week's trending article topics",
    `<p>${fresh.length} new topics from this week's accounting-world news (Ind AS / ICAI / NFRA / SEBI / SFIO / scams) were added to the article writer:</p>
     <ul>${fresh.map((t) => `<li>${esc(t.topic)}</li>`).join("")}</ul>
     <p>Articles will be written and published automatically. <a href="https://caparveensharma.com/admin/articles">Review or edit →</a></p>`);
  for (const a of admins ?? []) await sendEmail(String(a.email), `📰 ${fresh.length} trending topics queued this week`, html).catch(() => false);

  return NextResponse.json({ ok: true, added: fresh.length, headlines: headlines.length });
}
