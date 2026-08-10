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

/** Does the declared site carry our token? */
export async function verifyOwnership(url: string, token: string): Promise<SiteResult> {
  const text = await readPage(url);
  if (text === null) return { ok: false, problem: "unreachable", detail: `${url} did not answer.` };
  if (!text.includes(token)) {
    return {
      ok: false,
      problem: "ownership",
      detail: `The verification code ${token} was not found on ${url}.`,
    };
  }
  return { ok: true };
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

  // ── Discount, read arithmetically ────────────────────────────────────────
  for (const m of text.matchAll(/(\d{1,2})\s*%\s*(off|discount|less|छूट)/gi)) {
    const pct = Number(m[1]);
    if (pct > MAX_DISCOUNT) {
      const at = m.index ?? 0;
      return {
        ok: false,
        problem: "discount",
        detail: `${pct}% off is more than the ${MAX_DISCOUNT}% allowed.`,
        evidence: text.slice(Math.max(0, at - 120), at + 120).trim(),
      };
    }
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
