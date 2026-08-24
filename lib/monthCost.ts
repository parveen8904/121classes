import { createServiceClient } from "@/lib/supabase/service";
import { getBunnyBilling } from "@/lib/bunny";

// WHAT THIS MONTH IS COSTING, IN ONE PLACE.
//
// The costs page already worked this out, and the dashboard now needs the same
// number. Writing it twice is how two screens come to disagree about the same
// month — which is exactly the complaint that started the Zoho work, and the
// reason "Doubts waiting" on the dashboard was rebuilt to call the same
// function as the report it links to.
//
// USD IS THE UNIT HERE. Every provider bills in dollars, so the total is kept
// in dollars and converted once, where it is displayed. Mixing a rupee figure
// into this sum and converting the lot would multiply the dollar half by 85.
//
// The two flat plans are not live figures: Supabase and Vercel publish no
// billing API, so the founder's own entered amounts stand in, defaulting to his
// current plans. The costs page says so on its face and lets him correct them;
// this reads whatever he last set.

export type MonthCost = {
  ai: number;
  bunny: number;
  supabase: number;
  vercel: number;
  cloudflare: number;
  total: number;
};

const CFG_KEYS = ["supabase_plan_usd", "vercel_plan_usd", "cloudflare_bill_usd", "bunny_bill_usd"];

export async function monthCostUsd(): Promise<MonthCost> {
  const svc = createServiceClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [aiRes, cfgRes, bunnyBill] = await Promise.all([
    // Aggregated in the database. Adding the rows up here would be truncated at
    // PostgREST's 1,000-row cap, which once froze this figure four days into
    // the month at barely half the real spend.
    svc.rpc("ai_spend_since", { period_start: monthStart }),
    svc.from("site_settings").select("key, value").in("key", CFG_KEYS),
    getBunnyBilling().catch(() => null),
  ]);

  const ai = ((aiRes.data ?? []) as { cost_usd: number | string }[])
    .reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);

  const cfg = new Map((cfgRes.data ?? []).map((r) => [r.key as string, r.value as string]));
  const num = (k: string, fallback: number) => (cfg.get(k) != null ? Number(cfg.get(k)) || 0 : fallback);

  // Bunny live from its API where the account key is set; otherwise the figure
  // he entered from the Bunny dashboard.
  const bunny = bunnyBill?.thisMonth ?? num("bunny_bill_usd", 0);
  const supabase = num("supabase_plan_usd", 25);
  const vercel = num("vercel_plan_usd", 20);
  const cloudflare = num("cloudflare_bill_usd", 0);

  return { ai, bunny, supabase, vercel, cloudflare, total: ai + bunny + supabase + vercel + cloudflare };
}
