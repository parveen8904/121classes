import { rule115Rate } from "@/lib/forexRates";

// THE WORKING NOTE HE ACTUALLY USES, BUILT FROM THE ACTIVITY CSV.
//
// He sent the real thing — Robinhood, 1 Apr to 31 Dec 2025 — and it settles
// several questions I had guessed at. This file follows that document rather
// than an idea of it.
//
// What his note does, and why each part of it is right:
//
//   FIFO, CARRIED CONTINUOUSLY. A lot bought in an earlier period and sold in
//   this one keeps its original cost. Cost is not re-based at a period start.
//
//   A SALE WITH NO RECORDED PURCHASE IS SHOWN, NOT GUESSED. Shares held before
//   the data begins have no cost in the file. Their proceeds are listed on
//   their own, he fills the cost, and until he does the equity sub-total and
//   the net result DELIBERATELY EXCLUDE them — proceeds without cost are not a
//   gain, and showing them as one would overstate his income.
//
//   OPTIONS ARE ON A CASH BASIS, SEPARATELY. Net premium realised, by
//   underlying. Where a short call was assigned the share leg is already inside
//   the equity figures, so the premium is NOT also folded into proceeds — that
//   would count the same money twice. (My first attempt did exactly that.)
//
//   MANUFACTURED DIVIDENDS ARE NOT DIVIDENDS. Substitute payments on shares out
//   on loan are ordinary income; no treaty dividend rate applies to them, so
//   they are never mixed with cash dividends.
//
//   CAPITAL MOVEMENTS ARE EXCLUDED AND LISTED. Deposits, withdrawals, transfers
//   between brokerages and card cashback are not income. They are shown so the
//   note can be reconciled to the account rather than quietly dropped.

/* ═══════════════════════════════════════════════════════════════════════════
   THE ACTIVITY FILE
   ═══════════════════════════════════════════════════════════════════════════ */
export type Tx = {
  date: string;            // ISO
  instrument: string;
  description: string;
  code: string;
  qty: number;
  price: number;
  amount: number;          // signed, as the broker states it
};

/** Robinhood's own transaction codes, and what each one is. */
export const CODES = {
  BUY: ["Buy", "BUY"],
  SELL: ["Sell", "SELL"],
  STO: ["STO"], BTC: ["BTC"], BTO: ["BTO"], STC: ["STC"],
  OEXP: ["OEXP"], OASGN: ["OASGN"], OEXCS: ["OEXCS"],
  CDIV: ["CDIV"], MDIV: ["MDIV"], SLIP: ["SLIP"], INT: ["INT"], GDBP: ["GDBP"],
  MINT: ["MINT"],
  // Fees as the brokers actually code them — his Robinhood file uses FEE and
  // ACATO, not the AFEE/DFEE I had guessed at, which is why the ₹100 ACAT-out
  // charge went missing from the first run.
  // NOT ACATO here — that is the ten-thousand-dollar cash transfer out, which
  // is a capital movement listed under the excluded items. Counting it as a fee
  // as well took $10,000 off his income twice over.
  FEE: ["FEE", "AFEE", "DFEE", "GOLD"],
  ACH: ["ACH"], ITRF: ["ITRF"], ACAT: ["ACAT", "ACATO"], FUTSWP: ["FUTSWP"], XENT_CC: ["XENT_CC"],
};

const money = (s: string) => {
  const neg = /^\(.*\)$/.test(s.trim());
  const n = Number(s.replace(/[()$,\s]/g, "")) || 0;
  return neg ? -n : n;
};

/** A date as the broker writes it → ISO. */
function toIso(s: string): string {
  const t = s.trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  // Excel serial, which is how his own workbook carries dates.
  const serial = Number(t);
  if (serial > 20000 && serial < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  return "";
}

/** Split a CSV line, honouring quotes — descriptions carry commas. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === "," && !inQ) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseActivityCsv(text: string): Tx[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];

  // Find the header wherever it sits — brokers put titles above it.
  let headerAt = 0;
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    const l = lines[i].toLowerCase();
    if (l.includes("activity date") && l.includes("amount")) { headerAt = i; break; }
  }
  const header = splitCsv(lines[headerAt]).map((h) => h.toLowerCase());
  const at = (...names: string[]) => {
    for (const n of names) {
      const i = header.findIndex((h) => h === n || h.startsWith(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iDate = at("activity date", "date");
  const iInst = at("instrument", "symbol");
  const iDesc = at("description");
  const iCode = at("trans code", "code");
  const iQty = at("quantity", "qty");
  const iPrice = at("price");
  const iAmt = at("amount");
  if (iDate < 0 || iAmt < 0) return [];

  const out: Tx[] = [];
  for (const line of lines.slice(headerAt + 1)) {
    const c = splitCsv(line);
    const date = toIso(c[iDate] ?? "");
    if (!date) continue;
    out.push({
      date,
      instrument: (c[iInst] ?? "").trim(),
      description: (c[iDesc] ?? "").trim(),
      code: (c[iCode] ?? "").trim(),
      qty: Math.abs(Number((c[iQty] ?? "").replace(/[,\s]/g, "")) || 0),
      price: Math.abs(money(c[iPrice] ?? "")),
      amount: money(c[iAmt] ?? ""),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ═══════════════════════════════════════════════════════════════════════════
   FIFO — CONTINUOUS, AND HONEST ABOUT WHAT IT CANNOT COST
   ═══════════════════════════════════════════════════════════════════════════ */
export type MatchedTrade = {
  scrip: string; saleDate: string; purchaseDate: string; qty: number;
  proceeds: number; cost: number; pl: number; lot: "this period" | "earlier period";
};
export type ScripSummary = {
  scrip: string; buyQty: number; buyValue: number; sellQty: number; sellValue: number;
  matchedQty: number; matchedProceeds: number; matchedCost: number; realised: number;
  soldFromOpening: boolean; unmatchedSellQty: number;
  /** Bought and sold on the same day, where the file records no execution
   *  times. Which fill came first is then an assumption, not a fact, and the
   *  note says so instead of hiding it inside a total. */
  sameDayRoundTrip: boolean;
};
export type OpeningSale = { scrip: string; qtySold: number; proceeds: number; avgPrice: number };

type Lot = { date: string; qty: number; costPerUnit: number; earlier: boolean };

/**
 * Match every sale to the lots it came from, oldest first.
 *
 * `periodStart` only decides how a lot is LABELLED — cost is never re-based at
 * a period boundary, which is the whole point of carrying FIFO continuously.
 */
export function fifo(txs: Tx[], periodStart: string) {
  const lots = new Map<string, Lot[]>();
  const trades: MatchedTrade[] = [];
  const scrips = new Map<string, ScripSummary>();
  const opening: OpeningSale[] = [];

  const sum = (s: string) => {
    if (!scrips.has(s)) scrips.set(s, {
      scrip: s, buyQty: 0, buyValue: 0, sellQty: 0, sellValue: 0,
      matchedQty: 0, matchedProceeds: 0, matchedCost: 0, realised: 0,
      soldFromOpening: false, unmatchedSellQty: 0, sameDayRoundTrip: false,
    });
    return scrips.get(s)!;
  };

  // WITHIN A DAY, BUYS COME FIRST — you cannot sell what you have not bought.
  //
  // Robinhood lists a day's activity newest-first, so a same-day round trip
  // appears as the sale followed by the purchases that filled it. Taken in file
  // order the sale finds no lot and is written off as stock held from before
  // the file began: on his own statement that mis-stated 1,000 MSFT shares and
  // carried $145,819 into the wrong place. The order of two fills inside one
  // day is not information — the day is.
  const ordered = [...txs].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const rank = (t: Tx) => (CODES.BUY.includes(t.code) ? 0 : CODES.SELL.includes(t.code) ? 1 : 2);
    return rank(a) - rank(b);
  });

  // Where a scrip was both bought and sold on one day, say so.
  const dayKinds = new Map<string, Set<string>>();
  for (const t of txs) {
    if (!t.instrument) continue;
    const buy = CODES.BUY.includes(t.code), sell = CODES.SELL.includes(t.code);
    if (!buy && !sell) continue;
    const k = `${t.instrument}|${t.date}`;
    if (!dayKinds.has(k)) dayKinds.set(k, new Set());
    dayKinds.get(k)!.add(buy ? "b" : "s");
  }

  for (const t of ordered) {
    const isBuy = CODES.BUY.includes(t.code);
    const isSell = CODES.SELL.includes(t.code);
    if (!isBuy && !isSell) continue;
    if (!t.instrument) continue;
    const s = sum(t.instrument);
    if ((dayKinds.get(`${t.instrument}|${t.date}`)?.size ?? 0) > 1) s.sameDayRoundTrip = true;
    const value = Math.abs(t.amount);

    if (isBuy) {
      s.buyQty += t.qty; s.buyValue += value;
      const list = lots.get(t.instrument) ?? [];
      list.push({ date: t.date, qty: t.qty, costPerUnit: t.qty ? value / t.qty : 0, earlier: t.date < periodStart });
      lots.set(t.instrument, list);
      continue;
    }

    s.sellQty += t.qty; s.sellValue += value;
    let left = t.qty;
    const pricePerUnit = t.qty ? value / t.qty : 0;
    const list = lots.get(t.instrument) ?? [];

    while (left > 1e-9 && list.length) {
      const lot = list[0];
      const take = Math.min(left, lot.qty);
      const proceeds = take * pricePerUnit;
      const cost = take * lot.costPerUnit;
      trades.push({
        scrip: t.instrument, saleDate: t.date, purchaseDate: lot.date, qty: take,
        proceeds, cost, pl: proceeds - cost,
        lot: lot.earlier ? "earlier period" : "this period",
      });
      s.matchedQty += take; s.matchedProceeds += proceeds; s.matchedCost += cost; s.realised += proceeds - cost;
      lot.qty -= take; left -= take;
      if (lot.qty <= 1e-9) list.shift();
    }

    // WHAT IS LEFT WAS HELD BEFORE THE FILE BEGINS. It has no cost here, so it
    // is set aside for him rather than treated as pure profit.
    if (left > 1e-9) {
      s.soldFromOpening = true;
      s.unmatchedSellQty += left;
      const found = opening.find((o) => o.scrip === t.instrument);
      const proceeds = left * pricePerUnit;
      if (found) { found.qtySold += left; found.proceeds += proceeds; found.avgPrice = found.proceeds / found.qtySold; }
      else opening.push({ scrip: t.instrument, qtySold: left, proceeds, avgPrice: pricePerUnit });
    }
  }

  return { trades, scrips: [...scrips.values()].sort((a, b) => a.scrip.localeCompare(b.scrip)), opening };
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE NOTE
   ═══════════════════════════════════════════════════════════════════════════ */
export type OptionRow = {
  underlying: string; sto: number; btc: number; bto: number; stc: number; net: number; contracts: number;
};
export type Detail = { date: string; scrip: string; description: string; amount: number };

/** One Rule-115 rate, the head it converted and what it converted. */
export type RateUsed = { head: string; date: string; rate: number; usd: number; inr: number; count: number };

export type WorkingNote = {
  account: string; from: string; to: string;
  equity: {
    realisedFifo: number;
    uncostedProceeds: number;
    uncostedCost: number | null;       // his figure; null until he gives it
    subTotal: number;                  // EXCLUDES uncosted unless he has costed them
    scrips: ScripSummary[];
    trades: MatchedTrade[];
    opening: OpeningSale[];
  };
  options: { net: number; rows: OptionRow[] };
  income: { cashDividends: number; manufacturedDividends: number; stockLending: number; interest: number; subTotal: number;
            detail: Record<string, Detail[]> };
  charges: { marginInterest: number; fees: number; subTotal: number; detail: Detail[] };
  netResult: number;
  partial: boolean;                    // true while any sale is uncosted
  excluded: { label: string; amount: number }[];
  inr: { rate: number | null; note: string } | null;
};

const OPTION_CODES = new Set(["STO", "BTC", "BTO", "STC", "OEXP", "OASGN", "OEXCS"]);

export function buildWorkingNote(
  txs: Tx[], account: string, from: string, to: string, uncostedCost: number | null = null,
): WorkingNote {
  const inPeriod = txs.filter((t) => t.date >= from && t.date <= to);
  const upTo = txs.filter((t) => t.date <= to);        // FIFO needs the history before the period too

  const { trades, scrips, opening } = fifo(upTo, from);
  const periodTrades = trades.filter((t) => t.saleDate >= from && t.saleDate <= to);
  const realisedFifo = periodTrades.reduce((a, t) => a + t.pl, 0);
  const uncostedProceeds = opening.reduce((a, o) => a + o.proceeds, 0);

  // Options, by underlying, on a cash basis.
  const optMap = new Map<string, OptionRow>();
  for (const t of inPeriod) {
    if (!OPTION_CODES.has(t.code)) continue;
    const key = (t.instrument || t.description.split(" ")[0] || "—").toUpperCase();
    const r = optMap.get(key) ?? { underlying: key, sto: 0, btc: 0, bto: 0, stc: 0, net: 0, contracts: 0 };
    if (t.code === "STO") r.sto += t.amount;
    else if (t.code === "BTC") r.btc += t.amount;
    else if (t.code === "BTO") r.bto += t.amount;
    else if (t.code === "STC") r.stc += t.amount;
    r.net = r.sto + r.btc + r.bto + r.stc;
    r.contracts += t.qty;
    optMap.set(key, r);
  }
  const optionRows = [...optMap.values()].sort((a, b) => b.net - a.net);
  const optionsNet = optionRows.reduce((a, r) => a + r.net, 0);

  const pick = (codes: string[]) => inPeriod.filter((t) => codes.includes(t.code));
  const total = (rows: Tx[]) => rows.reduce((a, t) => a + t.amount, 0);
  const detail = (rows: Tx[]): Detail[] =>
    rows.map((t) => ({ date: t.date, scrip: t.instrument, description: t.description.slice(0, 90), amount: t.amount }));

  const cdiv = pick(CODES.CDIV), mdiv = pick(CODES.MDIV), slip = pick(CODES.SLIP);
  const int = pick([...CODES.INT, ...CODES.GDBP]);
  const mint = pick(CODES.MINT);
  const fees = pick(CODES.FEE);

  const income = {
    cashDividends: total(cdiv), manufacturedDividends: total(mdiv),
    stockLending: total(slip), interest: total(int),
    subTotal: total(cdiv) + total(mdiv) + total(slip) + total(int),
    detail: { cash: detail(cdiv), manufactured: detail(mdiv), lending: detail(slip), interest: detail(int) },
  };
  const charges = {
    marginInterest: total(mint), fees: total(fees),
    subTotal: total(mint) + total(fees),
    detail: [...detail(mint), ...detail(fees)],
  };

  const costed = uncostedCost !== null && uncostedProceeds > 0;
  const equitySubTotal = realisedFifo + (costed ? uncostedProceeds - (uncostedCost as number) : 0);
  const partial = uncostedProceeds > 0 && !costed;

  const excluded = [
    { label: "ACH deposits and withdrawals (net)", amount: total(pick(CODES.ACH)) },
    { label: "Transfer brokerage-to-brokerage (ITRF)", amount: total(pick(CODES.ITRF)) },
    { label: "ACAT-out cash transfer", amount: total(pick(CODES.ACAT)) },
    { label: "Futures inter-entity cash transfers (FUTSWP)", amount: total(pick(CODES.FUTSWP)) },
    { label: "Credit-card cashback (XENT_CC) — not investment income", amount: total(pick(CODES.XENT_CC)) },
  ].filter((e) => Math.abs(e.amount) > 0.005);

  return {
    account, from, to,
    equity: {
      realisedFifo, uncostedProceeds, uncostedCost,
      subTotal: equitySubTotal,
      scrips, trades: periodTrades, opening,
    },
    options: { net: optionsNet, rows: optionRows },
    income, charges,
    netResult: equitySubTotal + optionsNet + income.subTotal + charges.subTotal,
    partial, excluded,
    inr: null,
  };
}

/**
 * The rupee value of the note, each head at the Rule-115 rate of its own
 * transaction — never the period's closing rate, and never an average.
 */
export async function inrOf(
  txs: Tx[], from: string, to: string,
): Promise<{ byHead: Record<string, number>; rates: RateUsed[]; missing: string[] }> {
  const inPeriod = txs.filter((t) => t.date >= from && t.date <= to);
  const rates = new Map<string, number>();
  const used = new Map<string, RateUsed>();
  const missing = new Set<string>();
  const rateFor = async (date: string) => {
    if (rates.has(date)) return rates.get(date)!;
    const r = await rule115Rate(date, "USD").catch(() => null);
    const v = r?.rate ?? 0;
    rates.set(date, v);
    if (!v) missing.add(date);
    return v;
  };
  const out: Record<string, number> = {};
  for (const t of inPeriod) {
    const r = await rateFor(t.date);
    if (!r) continue;
    const bucket =
      CODES.CDIV.includes(t.code) ? "cashDividends"
      : CODES.MDIV.includes(t.code) ? "manufacturedDividends"
      : CODES.SLIP.includes(t.code) ? "stockLending"
      : [...CODES.INT, ...CODES.GDBP].includes(t.code) ? "interest"
      : CODES.MINT.includes(t.code) ? "marginInterest"
      : CODES.FEE.includes(t.code) ? "fees"
      : OPTION_CODES.has(t.code) ? "options"
      : null;
    if (!bucket) continue;
    out[bucket] = (out[bucket] ?? 0) + t.amount * r;
    // EVERY RATE THE NOTE STANDS ON, KEPT.
    //
    // The conversion is per transaction under Rule 115, so "the rate we used"
    // is not one number — it is one per date, and the note is only checkable if
    // it says which. Each is recorded against the head it converted, with the
    // dollars it converted, so a reader can re-perform any line of the note.
    const key = `${bucket}|${t.date}`;
    const seen = used.get(key);
    if (seen) { seen.usd += t.amount; seen.inr += t.amount * r; seen.count += 1; }
    else used.set(key, { head: bucket, date: t.date, rate: r, usd: t.amount, inr: t.amount * r, count: 1 });
  }
  return {
    byHead: out,
    rates: [...used.values()].sort((a, b) => (a.head === b.head ? a.date.localeCompare(b.date) : a.head.localeCompare(b.head))),
    missing: [...missing].sort(),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   FROM THE FILE TO A SAVED NOTE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Read an activity CSV, build the note, and keep it.
 *
 * The file itself is kept too. A working note whose source has been thrown away
 * cannot be re-checked, and this one carries figures that go into a return.
 */
export async function ingestActivityCsv(p: {
  account: string; from: string; to: string; fileRef: string; fileName: string;
}): Promise<{ id: string; note: WorkingNote } | { error: string }> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const { resolveFileUrl, isSecureRef } = await import("@/lib/storage");

  const url = isSecureRef(p.fileRef) ? await resolveFileUrl(p.fileRef, 300) : p.fileRef;
  if (!url) return { error: "the uploaded file could not be read back" };
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { error: `the uploaded file could not be read back (${res.status})` };
  const text = await res.text();

  const txs = parseActivityCsv(text);
  if (!txs.length) {
    return { error: "no transactions were found — the file needs the broker's own activity columns (Activity Date, Instrument, Code, Quantity, Price, Amount)" };
  }

  const note = buildWorkingNote(txs, p.account, p.from, p.to);
  const conv = await inrOf(txs, p.from, p.to)
    .catch(() => ({ byHead: {} as Record<string, number>, rates: [] as RateUsed[], missing: [] as string[] }));
  const inr = conv.byHead;

  // The rupee value of each equity sale at the rate for ITS OWN date, never one
  // rate for the period.
  let equityInr = 0;
  const rateCache = new Map<string, number>();
  const equityRates = new Map<string, RateUsed>();
  for (const t of note.equity.trades) {
    let r = rateCache.get(t.saleDate);
    if (r === undefined) {
      const got = await rule115Rate(t.saleDate, "USD").catch(() => null);
      r = got?.rate ?? 0;
      rateCache.set(t.saleDate, r);
    }
    equityInr += t.pl * r;
    const seen = equityRates.get(t.saleDate);
    if (seen) { seen.usd += t.pl; seen.inr += t.pl * r; seen.count += 1; }
    else equityRates.set(t.saleDate, { head: "equityRealised", date: t.saleDate, rate: r, usd: t.pl, inr: t.pl * r, count: 1 });
  }

  const svc = createServiceClient();
  const row = {
    account_name: p.account, period_start: p.from, period_end: p.to,
    workbook: {
      ...note,
      inrByHead: { ...inr, equityRealised: equityInr },
      // The rates the whole note stands on, so it can be re-performed and so the
      // page can show him exactly what was applied instead of asking him to
      // trust it.
      ratesUsed: [...conv.rates, ...[...equityRates.values()].sort((a, b) => a.date.localeCompare(b.date))],
      ratesMissing: conv.missing,
    } as unknown as Record<string, unknown>,
    buckets: {} as Record<string, unknown>,
    gain_inr: equityInr > 0 ? Number(equityInr.toFixed(2)) : 0,
    loss_inr: equityInr < 0 ? Number(Math.abs(equityInr).toFixed(2)) : 0,
    source_url: p.fileRef, currency: "USD",
    note: note.partial
      ? `$${note.equity.uncostedProceeds.toLocaleString("en-US", { maximumFractionDigits: 2 })} of sales have no purchase cost in the file — enter their cost below, or the equity sub-total stays short of them.`
      : null,
    status: "draft", updated_at: new Date().toISOString(),
  };

  const { data: existing } = await svc.from("brokerage_notes")
    .select("id, status").eq("account_name", p.account)
    .eq("period_start", p.from).eq("period_end", p.to).maybeSingle();
  if (existing && existing.status !== "draft") return { error: "that period already has a note that has been approved" };

  if (existing) {
    await svc.from("brokerage_notes").update(row).eq("id", existing.id);
    return { id: existing.id, note };
  }
  const { data: made, error } = await svc.from("brokerage_notes").insert(row).select("id").single();
  if (error || !made) return { error: error?.message ?? "the note could not be saved" };
  return { id: made.id, note };
}
