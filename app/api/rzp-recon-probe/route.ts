import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

// TEMPORARY — where do Razorpay's fees actually live? The settlement objects
// report fees=0 across all 107, which would leave the fee residue stuck in the
// clearing account for ever. The recon report lists every transaction inside a
// settlement with its own fee and tax; this asks it. Founder-gated, aggregates
// only. Removed once answered.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Login required", { status: 401 });
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return new NextResponse("Not available", { status: 404 });

  const year = req.nextUrl.searchParams.get("year") || "2026";
  const month = req.nextUrl.searchParams.get("month") || "8";
  const id = await getSecret("RAZORPAY_KEY_ID");
  const secret = await getSecret("RAZORPAY_KEY_SECRET");
  const auth = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

  const r = await fetch(`https://api.razorpay.com/v1/settlements/recon/combined?year=${year}&month=${month}&count=1000`, {
    headers: { Authorization: auth }, cache: "no-store",
  });
  if (!r.ok) return NextResponse.json({ status: r.status, body: (await r.text()).slice(0, 300) });
  const j = (await r.json()) as { items?: Record<string, unknown>[]; count?: number };
  const items = j.items ?? [];
  const num = (v: unknown) => Number(v) || 0;
  // Break down by TYPE: a settlement is payments in, refunds/adjustments out.
  const byType = new Map<string, { n: number; credit: number; debit: number; fee: number; tax: number }>();
  for (const it of items) {
    const t = String(it.type ?? "?");
    const cur = byType.get(t) ?? { n: 0, credit: 0, debit: 0, fee: 0, tax: 0 };
    cur.n++; cur.credit += num(it.credit); cur.debit += num(it.debit); cur.fee += num(it.fee); cur.tax += num(it.tax);
    byType.set(t, cur);
  }
  const bySettlement = new Map<string, { n: number; amount: number; fee: number; tax: number }>();
  for (const it of items) {
    const sid = String(it.settlement_id ?? "—");
    const cur = bySettlement.get(sid) ?? { n: 0, amount: 0, fee: 0, tax: 0 };
    // net movement, not raw amount: credits in, debits out
    cur.n++; cur.amount += num(it.credit) - num(it.debit); cur.fee += num(it.fee); cur.tax += num(it.tax);
    bySettlement.set(sid, cur);
  }
  const totals = [...bySettlement.values()].reduce((a, b) => ({
    n: a.n + b.n, amount: a.amount + b.amount, fee: a.fee + b.fee, tax: a.tax + b.tax,
  }), { n: 0, amount: 0, fee: 0, tax: 0 });

  return NextResponse.json({
    month: `${year}-${month}`,
    byType: [...byType.entries()].map(([t, v]) => ({ type: t, n: v.n, credit: v.credit / 100, debit: v.debit / 100, fee: v.fee / 100, tax: v.tax / 100 })),
    transactions: items.length,
    settlements: bySettlement.size,
    totals_paise: totals,
    totals_rupees: { amount: totals.amount / 100, fee: totals.fee / 100, tax: totals.tax / 100 },
    sampleKeys: items[0] ? Object.keys(items[0]) : null,
    sample: items[0] ?? null,
    perSettlementSample: [...bySettlement.entries()].slice(0, 3).map(([sid, v]) => ({
      settlement_id: sid, txns: v.n, amount: v.amount / 100, fee: v.fee / 100, tax: v.tax / 100,
      net_after_fees: (v.amount - v.fee - v.tax) / 100,
    })),
  });
}
