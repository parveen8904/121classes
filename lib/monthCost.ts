import { createServiceClient } from "@/lib/supabase/service";
import { getBunnyBilling } from "@/lib/bunny";

// WHAT THIS MONTH IS COSTING, IN ONE PLACE — FROM THE REAL FIGURES.
//
// The costs page already worked this out and the dashboard needs the same
// number. Writing it twice is how two screens come to disagree about one month.
//
// WHERE EACH NUMBER COMES FROM, BEST FIRST. The first version of this took the
// two flat plan bases as gospel — $25 Supabase, $20 Vercel — while cost_history
// already held the real invoices for the very same month: $42.24 and $30.58.
// It under-reported the month by more than a quarter, and the real figures were
// sitting one table away. So:
//
//   AI         · measured, always. Our own ai_usage log via ai_spend_since,
//                aggregated in the database (summing the rows here is cut off
//                at PostgREST's 1,000 and once froze this at half the truth).
//   Bunny      · live from its billing API where the account key is set.
//   Everything · the invoice recorded for THIS month in cost_history; failing
//                else       that, the LAST invoice on record, because what they
//                           charged last month is a far better estimate than a
//                           plan base that ignores usage; failing that, the
//                           figure he typed on the costs page; only then the
//                           plan default.
//
// Supabase and Vercel publish no usage-cost API — their management APIs give
// the plan ("pro"), not the bill — so cost_history, written from the actual
// invoices, IS the real data for them. Each figure carries where it came from,
// so a screen can say "invoiced" rather than implying a live reading.
//
// USD IS THE UNIT. Every provider bills in dollars; the total is summed in
// dollars and converted once, where it is displayed. Revenue is already rupees
// and must never pass through that converter.

export type CostSource = "measured" | "live" | "invoice" | "last-invoice" | "entered" | "plan";
export type CostPart = { usd: number; from: CostSource };
export type MonthCost = {
  ai: CostPart; bunny: CostPart; supabase: CostPart; vercel: CostPart; cloudflare: CostPart;
  total: number;
  /** True when any part is a stand-in rather than this month's own figure. */
  estimated: boolean;
};

const CFG_KEYS = ["supabase_plan_usd", "vercel_plan_usd", "cloudflare_bill_usd", "bunny_bill_usd"];
const PLAN_DEFAULT: Record<string, number> = { supabase: 25, vercel: 20, cloudflare: 0, bunny: 0 };

export async function monthCostUsd(): Promise<MonthCost> {
  const svc = createServiceClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}-01`;

  const [aiRes, cfgRes, histRes, bunnyBill] = await Promise.all([
    svc.rpc("ai_spend_since", { period_start: monthStart.toISOString() }),
    svc.from("site_settings").select("key, value").in("key", CFG_KEYS),
    svc.from("cost_history").select("month, provider, amount_usd, source").order("month", { ascending: false }),
    getBunnyBilling().catch(() => null),
  ]);

  const ai: CostPart = {
    usd: ((aiRes.data ?? []) as { cost_usd: number | string }[]).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0),
    from: "measured",
  };

  const cfg = new Map((cfgRes.data ?? []).map((r) => [r.key as string, r.value as string]));
  type Hist = { month: string; provider: string; amount_usd: number | string; source: string };
  const hist = (histRes.data ?? []) as Hist[];

  /** This month's recorded invoice for a provider, else the most recent one. */
  const recorded = (provider: string): { usd: number; from: CostSource } | null => {
    const rows = hist.filter((h) => h.provider === provider && Number(h.amount_usd) > 0);
    const thisMonth = rows.find((h) => String(h.month).slice(0, 10) === monthKey);
    if (thisMonth) return { usd: Number(thisMonth.amount_usd), from: "invoice" };
    const latest = rows[0]; // already ordered newest first
    return latest ? { usd: Number(latest.amount_usd), from: "last-invoice" } : null;
  };

  const entered = (key: string): number | null => {
    const v = cfg.get(key);
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const part = (provider: string, cfgKey: string): CostPart => {
    const rec = recorded(provider);
    if (rec) return rec;
    const typed = entered(cfgKey);
    if (typed != null) return { usd: typed, from: "entered" };
    return { usd: PLAN_DEFAULT[provider] ?? 0, from: "plan" };
  };

  // Bunny is the one non-AI provider with a live billing API.
  const bunny: CostPart = bunnyBill
    ? { usd: bunnyBill.thisMonth, from: "live" }
    : part("bunny", "bunny_bill_usd");

  const supabase = part("supabase", "supabase_plan_usd");
  const vercel = part("vercel", "vercel_plan_usd");
  const cloudflare = part("cloudflare", "cloudflare_bill_usd");

  const parts = [ai, bunny, supabase, vercel, cloudflare];
  return {
    ai, bunny, supabase, vercel, cloudflare,
    total: parts.reduce((s, p) => s + p.usd, 0),
    estimated: parts.some((p) => p.from === "last-invoice" || p.from === "entered" || p.from === "plan"),
  };
}
