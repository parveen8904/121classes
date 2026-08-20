import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { getBunnyBilling } from "@/lib/bunny";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// MONTHLY COST SNAPSHOT — the founder's rule: the invoice sync must happen by
// itself every month, not only when he asks. Runs on the 1st (see vercel.json)
// and writes one cost_history row per provider for the month that JUST CLOSED,
// so the ledger answers "how much have they already taken?" without anyone
// touching it.
//
//   · AI      — measured exactly from our own ai_usage log for that month.
//   · Bunny   — pulled live from Bunny's billing API (ThisMonthCharges) if the
//               BUNNY_ACCOUNT_API_KEY is set; otherwise skipped (no guessing).
//   · Vercel / Supabase / Cloudflare — captured from the real-invoice figures
//               kept on the costs page (these three expose no billing API). The
//               snapshot freezes whatever the current figure is into history;
//               the founder keeps that figure honest by updating it (or Claude
//               reads the dashboards) when a new invoice lands.
//
// Idempotent: re-running the same month overwrites its rows, never duplicates.

async function num(svc: ReturnType<typeof createServiceClient>, key: string, dflt: number): Promise<number> {
  const { data } = await svc.from("site_settings").select("value").eq("key", key).maybeSingle();
  const v = data?.value as string | undefined;
  return v != null && v.trim() !== "" ? Number(v) || 0 : dflt;
}

export async function GET(req: NextRequest) {
  const secret = await getSecret("CRON_SECRET");
  if (secret) {
    const ok = req.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(req.url).searchParams.get("key") === secret;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const svc = createServiceClient();

  // The month that just closed. On 1 Sep this snapshots August. A manual run
  // mid-month can pass ?month=this to snapshot the current month instead.
  const now = new Date();
  const thisMonth = new URL(req.url).searchParams.get("month") === "this";
  const target = thisMonth
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const monthStr = target.toISOString().slice(0, 10);
  const periodStart = monthStr;
  const periodEnd = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);

  const rows: { month: string; provider: string; amount_usd: number; source: string; note?: string }[] = [];

  // AI — exact, from the usage log for that month window.
  try {
    const { data: aiRows } = await svc.rpc("ai_spend_since", { period_start: periodStart + "T00:00:00Z" });
    // ai_spend_since is "since" — for a closed month, subtract anything that
    // spilled past its end so the figure is the month alone.
    const { data: aiRowsAfter } = await svc.rpc("ai_spend_since", { period_start: periodEnd + "T00:00:00Z" });
    const sum = (rs: unknown) => ((rs ?? []) as { cost_usd: number | string }[]).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
    const ai = Math.max(0, sum(aiRows) - sum(aiRowsAfter));
    rows.push({ month: monthStr, provider: "ai", amount_usd: Number(ai.toFixed(2)), source: "measured", note: "from ai_usage log" });
  } catch { /* skip AI if the RPC is unavailable */ }

  // Bunny — live from Bunny's own billing API, only if the account key is set.
  const bunny = await getBunnyBilling();
  if (bunny) {
    rows.push({ month: monthStr, provider: "bunny", amount_usd: Number(bunny.thisMonth.toFixed(2)), source: "live", note: "Bunny ThisMonthCharges" });
  }

  // The three no-API providers — freeze the current real-invoice figures.
  rows.push({ month: monthStr, provider: "vercel", amount_usd: await num(svc, "vercel_plan_usd", 20), source: "invoice", note: "figure on costs page" });
  rows.push({ month: monthStr, provider: "supabase", amount_usd: await num(svc, "supabase_plan_usd", 25), source: "invoice", note: "figure on costs page" });
  rows.push({ month: monthStr, provider: "cloudflare", amount_usd: await num(svc, "cloudflare_bill_usd", 0), source: "invoice", note: "figure on costs page" });

  await svc.from("cost_history").upsert(
    rows.map((r) => ({ ...r })),
    { onConflict: "month,provider" },
  );

  return NextResponse.json({ ok: true, month: monthStr, wrote: rows.length, rows });
}
