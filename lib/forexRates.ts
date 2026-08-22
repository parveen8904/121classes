import { createServiceClient } from "@/lib/supabase/service";

// RULE 115 RATES — SBI TT BUYING, from the founder's designated source ONLY.
//
// officialforexrates.com archives the SBI TT rates daily from 1 Jan 2022
// (taken from SBI's "to be used as reference rates" publication). Every rate
// used in a conversion is stored here with its date and source, so the working
// behind any converted figure is auditable years later.
//
// SBI publishes nothing on weekends/holidays. Rule 115 practice: use the rate
// of the nearest PRECEDING published day — the lookup walks back up to 7 days.

const SOURCE = "https://officialforexrates.com/";

export type TtRate = { currency: string; ttBuy: number };

/** Fetch one day's table from the source (null = SBI published nothing that day). */
export async function fetchSbiTtRates(dateISO: string): Promise<TtRate[] | null> {
  // The site is a Rails app: GET for the CSRF token + session cookie, then POST the date.
  const first = await fetch(SOURCE, { cache: "no-store" });
  const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0];
  const html0 = await first.text();
  const token = html0.match(/name="authenticity_token" value="([^"]+)"/)?.[1];
  if (!token) throw new Error("rates source: could not read the form token");

  const res = await fetch(SOURCE, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams({ authenticity_token: token, date: dateISO }),
    cache: "no-store",
  });
  const html = await res.text();
  if (/NO DATA PUBLISHED/i.test(html)) return null;

  // Cells stream as: CURRENCY | TT BUY | TT SELL | … per row (USD/INR first).
  const cells = [...html.matchAll(/<t[hd][^>]*>([^<]+)<\/t[hd]>/g)].map((m) => m[1].trim());
  const out: TtRate[] = [];
  for (let i = 0; i < cells.length; i++) {
    const m = cells[i].match(/^([A-Z]{3})\/INR$/);
    if (m) {
      const ttBuy = Number(cells[i + 1]);
      if (Number.isFinite(ttBuy) && ttBuy > 0) out.push({ currency: m[1], ttBuy });
    }
  }
  return out.length ? out : null;
}

const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * The SBI TT buying rate applicable ON a date: that day's published rate, or
 * the nearest preceding published day's (weekends/holidays). DB-first; fetches
 * and stores anything missing so a rate is only ever pulled once.
 */
export async function ttBuyRate(dateISO: string, currency = "USD"):
  Promise<{ rate: number; rateDate: string } | null> {
  const svc = createServiceClient();
  let d = dateISO;
  for (let hop = 0; hop < 8; hop++) {
    const { data: hit } = await svc.from("forex_rates")
      .select("tt_buy").eq("rate_date", d).eq("currency", currency).maybeSingle();
    if (hit) return { rate: Number(hit.tt_buy), rateDate: d };

    // Not stored — was this date already probed and found unpublished?
    const { data: probed } = await svc.from("forex_rates")
      .select("tt_buy").eq("rate_date", d).eq("currency", "NONE").maybeSingle();
    if (!probed) {
      const rates = await fetchSbiTtRates(d);
      if (rates) {
        await svc.from("forex_rates").upsert(
          rates.map((r) => ({ rate_date: d, currency: r.currency, tt_buy: r.ttBuy })),
          { onConflict: "rate_date,currency" },
        );
        const mine = rates.find((r) => r.currency === currency);
        if (mine) return { rate: mine.ttBuy, rateDate: d };
      } else {
        // Remember "nothing published" so holidays aren't re-fetched forever.
        await svc.from("forex_rates").upsert(
          [{ rate_date: d, currency: "NONE", tt_buy: 0 }], { onConflict: "rate_date,currency" });
      }
    }
    d = dayBefore(d);
  }
  return null;
}

/**
 * THE Rule 115 rate for an income: the TT buying rate on the LAST DAY of the
 * month PRECEDING the month in which the income arose (capital gains: pass the
 * transfer date; interest/dividend: the date the income arose).
 */
export async function rule115Rate(incomeDateISO: string, currency = "USD"):
  Promise<{ rate: number; rateDate: string; keyDate: string } | null> {
  const d = new Date(`${incomeDateISO}T00:00:00Z`);
  const lastOfPrevMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
  const key = lastOfPrevMonth.toISOString().slice(0, 10);
  const r = await ttBuyRate(key, currency);
  return r ? { ...r, keyDate: key } : null;
}
