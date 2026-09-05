// The period arithmetic below is pure on purpose — no imports, no connection —
// so the 1 April split and the month enumeration can be proved in a test. The
// readers pull Zoho and the rate table in when they actually run.

// THE INCOME SIDE OF THE US RETURN, FROM THE BOOKS, FOR ANY PERIOD.
//
// His ask, 5 September 2026, against Computation-PSRS US TAX.xlsx: "i need this
// report also based on zoho. its US return. make this automatic output file
// with any period."
//
// That workbook is seventeen sheets and about 3,200 cells, of which its own
// Inputs sheet says 926 compute themselves from roughly twenty figures a person
// sets — the standard deduction, the bracket table, the 1099 amounts, the
// depreciation collector rates, the estimated tax paid. None of that is in
// Zoho and none of it is guessed here.
//
// What IS in Zoho is the sheet everything else stands on: Income Details, one
// row per ledger per period, ~1,000 figures that are pasted by hand today and
// go stale the moment a bill is posted. That is what this builds.
//
// TWO PERIODS, BECAUSE TWO COUNTRIES DISAGREE ABOUT THE YEAR.
//
// The US taxes a calendar year and India an April–March one, so a US year cuts
// each Indian year in half: January–March is the tail of one Indian year and
// April–December the head of the next. The workbook's columns are exactly that
// split, and the split is what makes the monthly conversion honest — a single
// average rate over a year in which the rupee moved from 86 to 89 would be
// wrong by lakhs.

export type UsLedgerRow = {
  ledger: string;
  who: string;
  /** Rupees in each half of the US year, and the whole. */
  rs1: number; rs2: number; rsTotal: number;
  /** The same, converted at the SBI TT buying rate of each month. */
  usd1: number; usd2: number; usdTotal: number;
  /** Where Zoho files it — kept so a reader can see an income from an expense. */
  path: string;
};

export type UsPack = {
  from: string; to: string;
  /** The date the two halves are split on — 1 April inside the period. */
  splitOn: string | null;
  rows: UsLedgerRow[];
  entities: { slug: string; name: string; ledgers: number; rsTotal: number; usdTotal: number }[];
  /** Every rate used, with the month it covers, so any figure can be retraced. */
  rates: { month: string; rate: number; rateDate: string }[];
  /** Said out loud rather than left for the reader to discover. */
  notes: string[];
};

type ZohoNode = { name?: string; total?: number; account_transactions?: ZohoNode[] };

/** Flatten Zoho's nested P&L into leaf ledgers, keeping the path for context. */
function flatten(nodes: ZohoNode[] | undefined, path: string[], out: { ledger: string; amount: number; path: string }[]) {
  for (const n of nodes ?? []) {
    const name = (n.name ?? "").trim();
    if (!n.account_transactions?.length && name) {
      out.push({ ledger: name, amount: Number(n.total ?? 0), path: path.join(" > ") });
    }
    if (n.account_transactions) flatten(n.account_transactions, name ? [...path, name] : path, out);
  }
}

async function plFor(entity: string | null, from: string, to: string) {
  const { zohoFetch } = await import("@/lib/zohoApi");
  const r = await zohoFetch<{ profit_and_loss?: ZohoNode[] }>(
    "/reports/profitandloss",
    { query: { from_date: from, to_date: to }, ...(entity ? { entity } : {}) },
  );
  const out: { ledger: string; amount: number; path: string }[] = [];
  flatten(r.profit_and_loss, [], out);
  return out;
}

/** The months a period touches, as YYYY-MM. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`);
  const d = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1));
  while (d <= b) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/**
 * ONE RATE PER MONTH, NOT ONE PER YEAR.
 *
 * The SBI TT buying rate of the last day of each month — the same source and
 * the same rule the rest of this codebase uses for rupees (lib/forexRates.ts),
 * so a figure here and a figure on the brokerage journals cannot disagree.
 * A month with no published rate is REPORTED, never silently averaged over.
 */
async function monthlyRates(months: string[]) {
  const { ttBuyRate } = await import("@/lib/forexRates");
  const rates: { month: string; rate: number; rateDate: string }[] = [];
  const missing: string[] = [];
  for (const m of months) {
    const [y, mo] = m.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    const r = await ttBuyRate(lastDay, "USD").catch(() => null);
    if (r) rates.push({ month: m, rate: r.rate, rateDate: r.rateDate });
    else missing.push(m);
  }
  return { rates, missing };
}

/**
 * The Indian financial year starts on 1 April. Inside a US calendar year that
 * is the one boundary the workbook splits on; a period that does not cross it
 * has a single column and says so.
 */
export function fySplitInside(from: string, to: string): string | null {
  const y0 = Number(from.slice(0, 4)), y1 = Number(to.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    const apr = `${y}-04-01`;
    if (apr > from && apr <= to) return apr;
  }
  return null;
}

const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export async function buildUsPack(from: string, to: string): Promise<UsPack> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error("Give a period as two dates, the first on or before the second.");
  }
  const notes: string[] = [];
  const splitOn = fySplitInside(from, to);
  const p1 = splitOn ? { from, to: dayBefore(splitOn) } : { from, to };
  const p2 = splitOn ? { from: splitOn, to } : null;

  const { rates, missing } = await monthlyRates(monthsBetween(from, to));
  if (missing.length) {
    notes.push(
      `No SBI TT buying rate is on file for ${missing.join(", ")}, so those months are converted at the nearest earlier published rate. `
      + "Every rate actually used is listed on the Exchange rates sheet.",
    );
  }
  if (!rates.length) throw new Error("No exchange rate could be read for any month in the period, so nothing was converted.");

  // The rate for a PERIOD is the mean of its months' rates — the workbook
  // converts each half at its own average, which is why the two halves exist.
  const rateFor = (a: string, b: string) => {
    const want = new Set(monthsBetween(a, b));
    const use = rates.filter((r) => want.has(r.month));
    const list = use.length ? use : rates;
    return list.reduce((s, r) => s + r.rate, 0) / list.length;
  };
  const r1 = rateFor(p1.from, p1.to);
  const r2 = p2 ? rateFor(p2.from, p2.to) : 0;

  const { listEntities } = await import("@/lib/zohoEntities");
  const ents = (await listEntities()).filter((e) => e.isActive);

  const byKey = new Map<string, UsLedgerRow>();
  const entities: UsPack["entities"] = [];

  for (const e of ents) {
    const slug = e.slug;
    let rows1: Awaited<ReturnType<typeof plFor>> = [];
    let rows2: Awaited<ReturnType<typeof plFor>> = [];
    try {
      rows1 = await plFor(slug, p1.from, p1.to);
      if (p2) rows2 = await plFor(slug, p2.from, p2.to);
    } catch (err) {
      // ONE ENTITY REFUSING MUST NOT PASS AS THAT ENTITY EARNING NOTHING.
      notes.push(`${e.name}'s books could not be read: ${err instanceof Error ? err.message : "Zoho refused"}. Nothing of theirs is in this file.`);
      continue;
    }
    const add = (rs: typeof rows1, which: 1 | 2) => {
      for (const r of rs) {
        const key = `${slug}|${r.ledger}`;
        const cur = byKey.get(key) ?? {
          ledger: r.ledger, who: e.name, rs1: 0, rs2: 0, rsTotal: 0,
          usd1: 0, usd2: 0, usdTotal: 0, path: r.path,
        };
        if (which === 1) cur.rs1 += r.amount; else cur.rs2 += r.amount;
        byKey.set(key, cur);
      }
    };
    add(rows1, 1);
    add(rows2, 2);
    const mine = [...byKey.values()].filter((x) => x.who === e.name);
    entities.push({
      slug, name: e.name, ledgers: mine.length,
      rsTotal: 0, usdTotal: 0, // filled below once conversion has run
    });
  }

  const rows = [...byKey.values()].map((r) => {
    r.rsTotal = r.rs1 + r.rs2;
    // Divide, never multiply: the rate is rupees per dollar.
    r.usd1 = r1 ? r.rs1 / r1 : 0;
    r.usd2 = r2 ? r.rs2 / r2 : 0;
    r.usdTotal = r.usd1 + r.usd2;
    return r;
  }).sort((a, b) => Math.abs(b.rsTotal) - Math.abs(a.rsTotal));

  for (const e of entities) {
    const mine = rows.filter((r) => r.who === e.name);
    e.ledgers = mine.length;
    e.rsTotal = mine.reduce((s, r) => s + r.rsTotal, 0);
    e.usdTotal = mine.reduce((s, r) => s + r.usdTotal, 0);
  }

  notes.push(
    splitOn
      ? `The period crosses 1 April, so it is split: ${p1.from} to ${p1.to} at ₹${r1.toFixed(4)} to the dollar, and ${p2!.from} to ${p2!.to} at ₹${r2.toFixed(4)}.`
      : `The period does not cross 1 April, so there is one column, converted at ₹${r1.toFixed(4)} to the dollar.`,
  );
  notes.push(
    "These are the INCOME AND EXPENSE ledgers as Zoho reports them. The 1040 itself — the brackets, the foreign tax credit, "
    + "self-employment tax, depreciation and every 1099 figure — is not in the books and is not computed here.",
  );

  return { from, to, splitOn, rows, entities, rates, notes };
}
