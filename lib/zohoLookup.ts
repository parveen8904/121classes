import { createServiceClient } from "@/lib/supabase/service";
import { zohoFetch } from "@/lib/zohoApi";

// ZOHO IDS, LOOKED UP ONCE INSTEAD OF ONCE PER POSTING.
//
// Zoho rate-limits by requests per minute and answers, in full:
//   "For security reasons you have been blocked for some time as you have
//    exceeded the maximum number of requests per minute."
// He met it releasing a run of approvals, and the two sales it hit did not post.
//
// The cause is the same shape as the access-token one. Every posting resolves
// its ledgers by NAME — Sales-Classes, Razorpay Clearing, the TDS tax — and the
// caches doing so lived in module memory, which on Vercel is one cache per warm
// lambda and none at all on a cold start. Eighteen bills released together
// therefore made several /chartofaccounts calls each, and Zoho stopped
// answering.
//
// An account id never changes, so it is cached in the database where every
// invocation shares it. A miss still asks Zoho; a hit costs one row read.
// Cached for a week rather than for ever, so an account renamed or replaced in
// Zoho is picked up without anybody having to know this file exists.

const TTL_MS = 7 * 24 * 3600 * 1000;
const KEY = (kind: string, name: string) => `zoho_id:${kind}:${name}`;

type Cached = { id: string; at: number };

async function fromCache(kind: string, name: string): Promise<string | null> {
  try {
    const { data } = await createServiceClient()
      .from("app_secrets").select("value").eq("key", KEY(kind, name)).maybeSingle();
    if (!data?.value) return null;
    const c = JSON.parse(String(data.value)) as Cached;
    return c.id && Date.now() - c.at < TTL_MS ? c.id : null;
  } catch { return null; }
}

async function toCache(kind: string, name: string, id: string): Promise<void> {
  try {
    await createServiceClient().from("app_secrets")
      .upsert({ key: KEY(kind, name), value: JSON.stringify({ id, at: Date.now() } as Cached) }, { onConflict: "key" });
  } catch { /* a cache that cannot be written must not fail the posting */ }
}

/** The Zoho account id for an exact ledger name. Throws if Zoho has no such
 *  account — a posting must never invent one. */
export async function accountId(name: string): Promise<string> {
  const hit = await fromCache("account", name);
  if (hit) return hit;
  const r = await zohoFetch<{ chartofaccounts?: { account_id: string; account_name: string }[] }>(
    "/chartofaccounts", { query: { search_text: name, filter_by: "AccountType.All" } });
  const found = (r.chartofaccounts ?? []).find((a) => a.account_name === name);
  if (!found) throw new Error(`Zoho account "${name}" not found`);
  await toCache("account", name, found.account_id);
  return found.account_id;
}

/** The Zoho tax id for an exact tax name, or null where Zoho holds no match —
 *  the caller decides whether that is fatal. */
export async function taxId(name: string, filterBy?: string): Promise<string | null> {
  if (!name) return null;
  const hit = await fromCache("tax", name);
  if (hit) return hit;
  const r = await zohoFetch<{ taxes?: { tax_id: string; tax_name: string }[] }>(
    "/settings/taxes", filterBy ? { query: { filter_by: filterBy } } : undefined).catch(() => null);
  const found = (r?.taxes ?? []).find((t) => t.tax_name === name);
  if (!found) return null;
  await toCache("tax", name, found.tax_id);
  return found.tax_id;
}

/** Forget one cached id — for use after renaming or recreating an account. */
export async function forgetZohoId(kind: "account" | "tax", name: string): Promise<void> {
  try {
    await createServiceClient().from("app_secrets").delete().eq("key", KEY(kind, name));
  } catch { /* ignore */ }
}
