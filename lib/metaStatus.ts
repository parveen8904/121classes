import { getSecret } from "@/lib/secrets";

// WHERE META HAS GOT TO WITH US.
//
// Business verification, the WhatsApp account's review, and the state of the
// number itself all live in Meta's Business Manager, behind a login. Which
// means the honest answer to "are we verified yet?" has been "log in and look",
// and nobody looks every day.
//
// Meta will simply tell us. The token we already hold can ask, so the answer
// belongs on the Integrations page beside everything else.

export type MetaStatus = {
  ok: boolean;
  /** Set when we could not ask at all. */
  problem?: string;
  business?: { name?: string; verification_status?: string };
  waba?: { name?: string; account_review_status?: string };
  phone?: {
    display_phone_number?: string;
    verified_name?: string;
    name_status?: string;
    code_verification_status?: string;
    quality_rating?: string;
    messaging_limit?: string;
  };
};

const G = "https://graph.facebook.com/v23.0";

async function ask(path: string, token: string): Promise<any | null> {
  try {
    const res = await fetch(`${G}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      // Meta's answer changes on their schedule, not ours; an hour-old answer
      // is fine and keeps this off the critical path of a page load.
      next: { revalidate: 3600 },
    });
    const j = await res.json();
    if (!res.ok) return { __error: j?.error?.message || `HTTP ${res.status}` };
    return j;
  } catch (e) {
    return { __error: e instanceof Error ? e.message : "could not reach Meta" };
  }
}

export async function metaStatus(): Promise<MetaStatus> {
  const token = (await getSecret("WHATSAPP_CLOUD_TOKEN")).trim();
  const waba = (await getSecret("WHATSAPP_WABA_ID")).trim();
  const phoneId = (await getSecret("WHATSAPP_PHONE_NUMBER_ID")).trim();
  if (!token) return { ok: false, problem: "No WhatsApp token saved yet." };

  const out: MetaStatus = { ok: true };

  if (waba) {
    // The business that OWNS the WhatsApp account is where verification sits —
    // not on the account itself, which is why it is easy to look in the wrong
    // place and conclude nothing is happening.
    const w = await ask(
      `${waba}?fields=name,account_review_status,owner_business_info{id,name,verification_status}`,
      token,
    );
    if (w?.__error) out.problem = w.__error;
    else {
      out.waba = { name: w?.name, account_review_status: w?.account_review_status };
      const b = w?.owner_business_info;
      if (b) out.business = { name: b.name, verification_status: b.verification_status };
    }
  }

  if (phoneId) {
    const p = await ask(
      `${phoneId}?fields=display_phone_number,verified_name,name_status,code_verification_status,quality_rating,messaging_limit_tier`,
      token,
    );
    if (!p?.__error) {
      out.phone = {
        display_phone_number: p?.display_phone_number,
        verified_name: p?.verified_name,
        name_status: p?.name_status,
        code_verification_status: p?.code_verification_status,
        quality_rating: p?.quality_rating,
        messaging_limit: p?.messaging_limit_tier,
      };
    } else if (!out.problem) out.problem = p.__error;
  }

  if (!out.waba && !out.phone) out.ok = false;
  return out;
}

/** Meta's words are shouty and abbreviated; say what they mean. */
export function inPlainEnglish(field: string, value?: string): string {
  if (!value) return "not reported";
  const v = value.toUpperCase();
  const map: Record<string, string> = {
    VERIFIED: "✅ verified",
    NOT_VERIFIED: "⚠️ not verified yet",
    PENDING: "⏳ pending with Meta",
    PENDING_NEED_MORE_INFO: "⚠️ Meta has asked for more information",
    PENDING_SUBMISSION: "⚠️ started but never submitted",
    FAILED: "❌ rejected",
    EXPIRED: "⚠️ expired",
    REJECTED: "❌ rejected",
    APPROVED: "✅ approved",
    DECLINED: "❌ declined",
    AVAILABLE_WITHOUT_REVIEW: "✅ live (no review needed)",
    NONE: "— none",
    GREEN: "✅ good",
    YELLOW: "⚠️ medium",
    RED: "❌ poor",
    UNKNOWN: "not rated yet",
  };
  if (map[v]) return map[v];
  if (field === "messaging_limit") {
    const tiers: Record<string, string> = {
      TIER_50: "50 people a day",
      TIER_250: "250 people a day",
      TIER_1K: "1,000 people a day",
      TIER_10K: "10,000 people a day",
      TIER_100K: "100,000 people a day",
      TIER_UNLIMITED: "unlimited",
    };
    if (tiers[v]) return tiers[v];
  }
  return value;
}
