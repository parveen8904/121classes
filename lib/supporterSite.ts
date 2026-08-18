import { createServiceClient } from "@/lib/supabase/service";

// PROVING A SHOPFRONT IS YOURS, AND WATCHING WHAT IT SAYS.
//
// A supporter declares the website they sell from. Anybody can type any URL, so
// it means nothing until they prove it is theirs — the ordinary way, and the
// only way that does not need us to trust them: put a token we generate
// somewhere on the site. Only somebody who can publish to it can do that.
//
// After that the site is read on a schedule, looking for the two things the
// arrangement forbids:
//
//   • more than 5% off — undercutting the published price teaches students to
//     wait for a reseller instead of buying here;
//   • bundling with another faculty — his name sold as part of somebody else's
//     package, which he never agreed to.
//
// Nothing here decides anything on its own. A machine reading a shop page will
// misread it sometimes, and an accusation of cheating is not a thing to get
// wrong, so every finding is recorded for a person to look at.

/** Sixteen characters they must publish. Tied to the account, not the URL. */
export function siteToken(supporterId: string): string {
  // Deterministic so it survives a re-read of the page without being re-issued,
  // and long enough that it cannot be guessed from the id.
  let h = 0x811c9dc5;
  for (const ch of `caparveensharma:${supporterId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const a = h.toString(36);
  let g = 0x1000193;
  for (const ch of supporterId) { g ^= ch.charCodeAt(0); g = Math.imul(g, 0x811c9dc5) >>> 0; }
  return `cps-${a}${g.toString(36)}`.slice(0, 20);
}

export type SiteResult = {
  ok: boolean;
  problem?: "ownership" | "unreachable" | "discount" | "combo";
  detail?: string;
  evidence?: string;
};

const MAX_DISCOUNT = 5;

/**
 * The only thing on a reseller's page that identifies OUR course.
 *
 * Not the subject: "Advanced Accounting" and "Financial Reporting" are taught
 * by every faculty going, and treating those words as ours is what turned
 * other teachers' offers into fines.
 */
const OUR_NAME = /parveen\s*sharma/i;

/** Fetch a page as text, politely and with a limit. */
async function readPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": "caparveensharma-partner-check" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 120_000);
  } catch {
    return null;
  }
}

// LOOKING FOR THE TOKEN IN THE PAGE AS IT WAS SENT, NOT AS IT READS.
//
// This used to search the same stripped-down text the compliance check reads —
// scripts removed, then every tag removed. Two vendors published their code
// exactly as the screen told them to and were refused for a week: one put it in
// an HTML comment ("or an HTML comment", says our own instruction — and
// `<!-- … -->` is removed by the tag stripper), the other's shop keeps its
// footer inside the page's data payload, which the script stripper removed.
// Sixty-two presses of Check between them, every one a lie.
//
// A token is not prose. It is seventeen characters nobody could guess, so
// finding it ANYWHERE in what the site sent — comment, meta tag, footer,
// payload — is the proof. The stripping stays where it belongs: on the
// compliance reader below, which is about what a student can actually read.

/** The page exactly as sent. No stripping: a token may live in any of it. */
async function fetchRaw(url: string, bustCache = false): Promise<string | null> {
  try {
    const u = new URL(url);
    // A code published two minutes ago is often still invisible behind a CDN
    // serving this morning's copy — which is what happened to dreamca.co.in.
    if (bustCache) u.searchParams.set("_cps", String(Date.now()));
    const res = await fetch(u.toString(), {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "user-agent": "caparveensharma-partner-check",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 500_000);
  } catch {
    return null;
  }
}

/** Letters and digits only — how the token survives markup and stray dashes. */
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Is our token in what the site sent?
 *
 * Forgiving on purpose, because every way a real CMS mangles a pasted code is
 * still somebody having published it: escaped inside a data payload, wrapped in
 * markup mid-word, its hyphen turned into a dash by smart typography, an
 * invisible character carried in from a copy-paste, or simply capitalised.
 */
function carriesToken(html: string, token: string): boolean {
  const decoded = html
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d{1,6});/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "");   // zero-width junk from a copy-paste
  const both = `${html} ${decoded}`;

  // The page is searched BOTH as sent and with its tags taken out — as sent, so
  // a code in a comment or a meta tag counts; tags out, so a code an editor has
  // split down the middle (`<span>cps-</span><b>…</b>`) reads as one piece
  // again. Neither copy replaces the other; a token found in either is proof.
  const hay = `${both} ${both.replace(/<[^>]*>/g, "")}`.toLowerCase();
  if (hay.includes(token.toLowerCase())) return true;
  return compact(hay).includes(compact(token));
}

/** www or not, page or root — the same site by any of its ordinary spellings. */
function urlVariants(url: string): string[] {
  const out = [url];
  try {
    const u = new URL(url);
    out.push(`${u.origin}/`);
    const swapped = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
    out.push(`${u.protocol}//${swapped}/`);
  } catch { /* the fetch below reports a malformed address */ }
  return [...new Set(out)];
}

/** Does the declared site carry our token? */
export async function verifyOwnership(url: string, token: string): Promise<SiteResult> {
  let reached = false;

  const carries = async (target: string, bustCache: boolean) => {
    const html = await fetchRaw(target, bustCache);
    if (html === null) return false;
    reached = true;
    return carriesToken(html, token);
  };

  // The address they gave, and the ordinary variants of it.
  for (const target of urlVariants(url)) if (await carries(target, false)) return { ok: true };

  // Again, past their cache, for the vendor who published it a minute ago.
  for (const target of urlVariants(url)) if (await carries(target, true)) return { ok: true };

  // We ask for it "anywhere on the site", so honour that: a few more pages.
  if (reached) {
    for (const target of (await pagesToRead(url)).slice(1, 6)) {
      if (await carries(target, false)) return { ok: true };
    }
  }

  if (!reached) return { ok: false, problem: "unreachable", detail: `${url} did not answer.` };
  return {
    ok: false,
    problem: "ownership",
    detail:
      `The verification code ${token} was not found on ${url}. ` +
      `If you have just published it, give the site a minute to refresh and press Check again.`,
  };
}

/** The pages worth reading on a coaching shop, in the order worth reading them. */
const WORTH_READING =
  /(combo|bundle|package|offer|discount|sale|course|classes|pendrive|pen-drive|google-drive|ca-final|ca-inter|final|inter|product|shop|store|buy|checkout|catalog)/i;

/**
 * Which other pages on this site should we look at?
 *
 * A combo is never on the homepage. It is on a product page called "CA Final
 * Combo" or "Buy Both", two clicks in — so reading only the declared address
 * checks the one page least likely to carry the thing being looked for.
 *
 * The sitemap first, because a shop that publishes one is telling us exactly
 * where its products live. Otherwise the homepage's own links.
 */
async function pagesToRead(home: string): Promise<string[]> {
  const out = new Set<string>([home]);
  let origin = "";
  try { origin = new URL(home).origin; } catch { return [...out]; }

  const add = (href: string) => {
    try {
      const u = new URL(href, home);
      if (u.origin !== origin) return;                 // never wander off their site
      if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|css|js)$/i.test(u.pathname)) return;
      u.hash = "";
      if (WORTH_READING.test(u.pathname + u.search)) out.add(u.toString());
    } catch { /* a malformed link is not worth a failure */ }
  };

  // A sitemap names the product pages without us having to guess.
  for (const path of ["/sitemap.xml", "/sitemap_index.xml", "/product-sitemap.xml"]) {
    if (out.size > 12) break;
    try {
      const res = await fetch(`${origin}${path}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
        headers: { "user-agent": "caparveensharma-partner-check" },
      });
      if (!res.ok) continue;
      const xml = (await res.text()).slice(0, 400_000);
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) add(m[1]);
    } catch { /* no sitemap is ordinary */ }
  }

  // Failing that, the links on their own front page.
  if (out.size <= 1) {
    try {
      const res = await fetch(home, {
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
        headers: { "user-agent": "caparveensharma-partner-check" },
      });
      if (res.ok) {
        const html = (await res.text()).slice(0, 400_000);
        for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) add(m[1]);
      }
    } catch { /* the homepage read below will report it */ }
  }

  // A handful, not a crawl. We are checking a shop, not indexing it.
  return [...out].slice(0, 8);
}

/**
 * Read a supporter's shopfront and flag what the agreement forbids.
 *
 * The plain reading comes first — a percentage next to a discount word is
 * arithmetic, not judgement — and the model is asked only about the harder
 * question of whether our subject is being sold inside somebody else's bundle.
 *
 * Several pages, because a combo lives on a product page and never on the
 * homepage. The first real problem found stops the walk: one upheld breach is
 * enough for a person to act on, and there is no sense paying to read the rest.
 */
export async function inspectSite(home: string): Promise<SiteResult> {
  const pages = await pagesToRead(home);
  let reachedAny = false;
  let last: SiteResult = { ok: true };

  for (const url of pages) {
    const r = await inspectOnePage(url);
    if (r.problem === "unreachable") continue;
    reachedAny = true;
    if (!r.ok) return { ...r, detail: `${r.detail} (on ${url})` };
    last = r;
  }

  if (!reachedAny) return { ok: false, problem: "unreachable", detail: `${home} did not answer.` };
  return last;
}

async function inspectOnePage(url: string): Promise<SiteResult> {
  const text = await readPage(url);
  if (text === null) return { ok: false, problem: "unreachable", detail: `${url} did not answer.` };

  // ── Discount, read arithmetically, and only where it is OURS ─────────────
  //
  // This used to hold an account for any "N% off" anywhere on the page. A
  // reseller's store lists thirty courses by a dozen teachers, so there is
  // always some discount on it — and on 15 August three vendors were fined
  // ₹5,000 each for other people's offers. One was held for "CA Inter Audit
  // Regular By CA Rishabh Jain 10% off"; another for a DT/IDT combo by CA
  // Aarish Khan; the third was Aldine, the founder's own company.
  //
  // The agreement is about OUR price, so the discount must be near OUR course
  // — and the only thing that identifies it is HIS NAME. A subject line will
  // not do it: every faculty in the country sells "Advanced Accounting", and
  // one of those three pages said "Advanced Accounts by CA Anand Bhangariya"
  // a few words from the offer that got its vendor fined.
  const NEAR = 600;
  for (const m of text.matchAll(/(\d{1,2})\s*%\s*(off|discount|less|छूट)/gi)) {
    const pct = Number(m[1]);
    if (pct <= MAX_DISCOUNT) continue;
    const at = m.index ?? 0;
    const around = text.slice(Math.max(0, at - NEAR), at + NEAR);
    if (!OUR_NAME.test(around)) continue;   // somebody else's offer is not ours to police
    return {
      ok: false,
      problem: "discount",
      detail: `${pct}% off is more than the ${MAX_DISCOUNT}% allowed.`,
      evidence: text.slice(Math.max(0, at - 120), at + 120).trim(),
    };
  }

  // ── Bundled with another faculty ─────────────────────────────────────────
  // Only asked when our name is on the page at all; a shop selling nothing of
  // ours is not our business.
  const mentionsUs = /parveen\s*sharma|financial reporting|advanced accounting/i.test(text);
  if (!mentionsUs) return { ok: true };

  try {
    const { judgeSupporterPage } = await import("@/lib/ai");
    const verdict = await judgeSupporterPage(text.slice(0, 12_000));
    if (verdict && verdict.combo) {
      return {
        ok: false,
        problem: "combo",
        detail: verdict.why || "Our subject appears bundled with another faculty's course.",
        evidence: verdict.evidence?.slice(0, 400),
      };
    }
  } catch {
    // A model that cannot be reached must not become an accusation.
  }

  return { ok: true };
}

/** Write down what was seen, whatever it was. */
export async function recordCheck(supporterId: string, url: string, r: SiteResult): Promise<void> {
  try {
    await createServiceClient().from("supporter_site_checks").insert({
      supporter_id: supporterId,
      url,
      ok: r.ok,
      problem: r.problem ?? null,
      detail: r.detail ?? null,
      evidence: r.evidence ?? null,
    });
  } catch { /* the check matters more than our note of it */ }
}
