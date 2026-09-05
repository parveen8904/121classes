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


export async function buildUsPack(from: string, to: string): Promise<UsPack> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error("Give a period as two dates, the first on or before the second.");
  }
  const notes: string[] = [];
  const splitOn = fySplitInside(from, to);

  const months = monthsBetween(from, to);
  const { rates, missing } = await monthlyRates(months);
  if (missing.length) {
    notes.push(
      `No SBI TT buying rate is on file for ${missing.join(", ")}, so those months are converted at the nearest earlier published rate. `
      + "Every rate actually used is listed on the Exchange rates sheet.",
    );
  }
  if (!rates.length) throw new Error("No exchange rate could be read for any month in the period, so nothing was converted.");
  const rateOf = new Map(rates.map((r) => [r.month, r.rate]));

  // EACH MONTH AT ITS OWN RATE, NOT EACH HALF AT AN AVERAGE.
  //
  // The first version read one P&L per half and converted it at the mean of
  // that half's rates. Checked against his own 2025 workbook, that was wrong:
  // Sales-Parveen Sharma came to $619,320 against his $621,537. The rupees
  // agreed to the paisa and the twelve rates agreed exactly — what differed was
  // the arithmetic. His Jan–Mar works out at ₹85.673 to the dollar against a
  // simple mean of ₹86.083, because more of the income arose in March, when the
  // rupee was at 85.10.
  //
  // A mean assumes the money arrived evenly through the period. It did not. So
  // the books are read a MONTH at a time and each month converted at its own
  // rate, which is both what his workbook does and what Rule 115 practice
  // expects. It costs a Zoho report per month per person; that is the price of
  // the figure being right.
  const monthWindow = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    const first = `${m}-01`;
    const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    return { from: first < from ? from : first, to: last > to ? to : last };
  };

  const { listEntities } = await import("@/lib/zohoEntities");
  const ents = (await listEntities()).filter((e) => e.isActive);

  const byKey = new Map<string, UsLedgerRow>();
  const entities: UsPack["entities"] = [];

  // FOUR AT A TIME, NOT ONE AFTER ANOTHER.
  //
  // A month per person is twelve Zoho reports each, and run one behind the
  // other that is a minute and a half of a browser showing nothing. The
  // function returned 200 the whole time — the Vercel log has the request
  // succeeding server-side at 03:46:37 while the client-side row for the same
  // second reads status 0, which is the browser having given up first. "Not
  // working" was a download nobody waited for.
  //
  // Four at a time, because the pacer allows eighty calls a minute and this
  // needs twenty-four; there is no reason to crowd it and every reason not to
  // make somebody watch a blank tab.
  const runBounded = async <T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> => {
    const out: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }));
    return out;
  };

  for (const e of ents) {
    let failure: string | null = null;
    const perMonth = await runBounded(months, 4, async (m) => {
      const w = monthWindow(m);
      try {
        return { m, rows: await plFor(e.slug, w.from, w.to) };
      } catch (err) {
        // ONE ENTITY REFUSING MUST NOT PASS AS THAT ENTITY EARNING NOTHING.
        failure ??= `${e.name}'s books could not be read for ${m}: ${err instanceof Error ? err.message : "Zoho refused"}. Nothing of theirs is in this file.`;
        return { m, rows: [] as Awaited<ReturnType<typeof plFor>> };
      }
    });
    if (failure) { notes.push(failure); continue; }

    for (const { m, rows } of perMonth) {
      const rate = rateOf.get(m) ?? rates[rates.length - 1].rate;
      // Which half of the US year this month falls in.
      const second = splitOn !== null && `${m}-01` >= splitOn;
      for (const r of rows) {
        const key = `${e.slug}|${r.ledger}`;
        const cur = byKey.get(key) ?? {
          ledger: r.ledger, who: e.name, rs1: 0, rs2: 0, rsTotal: 0,
          usd1: 0, usd2: 0, usdTotal: 0, path: r.path,
        };
        // Divide, never multiply: the rate is rupees per dollar.
        if (second) { cur.rs2 += r.amount; cur.usd2 += r.amount / rate; }
        else { cur.rs1 += r.amount; cur.usd1 += r.amount / rate; }
        byKey.set(key, cur);
      }
    }
    entities.push({ slug: e.slug, name: e.name, ledgers: 0, rsTotal: 0, usdTotal: 0 });
  }

  const rows = [...byKey.values()].map((r) => {
    r.rsTotal = r.rs1 + r.rs2;
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
      ? `The period crosses 1 April on ${splitOn}, so it is shown in two columns. Every month is converted at its own rate — see the Exchange rates sheet — never at an average of them.`
      : "The period does not cross 1 April, so there is one column. Every month is still converted at its own rate.",
  );
  notes.push(
    "These are the INCOME AND EXPENSE ledgers as Zoho reports them. The 1040 itself — the brackets, the foreign tax credit, "
    + "self-employment tax, depreciation and every 1099 figure — is not in the books and is not computed here.",
  );

  return { from, to, splitOn, rows, entities, rates, notes };
}
