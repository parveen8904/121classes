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

/**
 * Read a supporter's shopfront and flag what the agreement forbids.
 *
 * The plain reading comes first — a percentage next to a discount word is
 * arithmetic, not judgement — and the model is asked only about the harder
 * question of whether our subject is being sold inside somebody else's bundle.
 */
export async function inspectSite(url: string): Promise<SiteResult> {
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
