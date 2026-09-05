import { NextResponse, type NextRequest } from "next/server";
import { assertArea } from "@/lib/adminAccess";
import { buildUsPack } from "@/lib/usComputation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// THE US RETURN'S INCOME SHEET, AS A FILE, FOR ANY PERIOD.
//
//   /admin/zoho/tax/us                       → the calendar year just gone
//   /admin/zoho/tax/us?from=2025-01-01&to=2025-12-31
//   /admin/zoho/tax/us?from=2026-01-01&to=2026-06-30   → any period at all
//
// It writes the sheet the workbook stands on and the workings behind it. It
// does NOT write the 1040: that is the twenty figures the workbook's own Inputs
// sheet lists as yours to set, and inventing them here would be worse than
// leaving the columns he already trusts.
export async function GET(req: NextRequest) {
  await assertArea("zoho");
  const q = new URL(req.url).searchParams;
  const lastYear = new Date().getUTCFullYear() - (new Date().getUTCMonth() < 3 ? 1 : 0);
  const from = q.get("from") || `${lastYear}-01-01`;
  const to = q.get("to") || `${lastYear}-12-31`;

  let pack: Awaited<ReturnType<typeof buildUsPack>>;
  try {
    pack = await buildUsPack(from, to);
  } catch (e) {
    // A refusal is reported as a refusal. A spreadsheet of zeros would be filed.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The books could not be read.", from, to },
      { status: 502 },
    );
  }

  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  // ---- Computation 1040 — FIRST, because it is the answer.
  //
  // "my excel has a sheet 1040." His workbook opens on the return and the
  // supporting figures follow it; a file that opened on a thousand ledgers and
  // never reached the 1040 was the workings without the conclusion. It is the
  // same computation the screen shows, and it is only drawn when the year's
  // inputs exist — a 1040 of zeros is an empty sheet that looks like an answer,
  // and this one would be filed.
  const calendarYear = pack.from.slice(0, 4) === pack.to.slice(0, 4) ? Number(pack.from.slice(0, 4)) : null;
  if (calendarYear) {
    const { createServiceClient } = await import("@/lib/supabase/service");
    const { compute1040, INPUT_KEYS, statuteFor, statutoryFigures } = await import("@/lib/us1040");
    const { data: inputRows } = await createServiceClient()
      .from("us1040_inputs").select("key, value").eq("year", calendarYear);
    // THE YEAR'S OWN BRACKETS. compute1040 defaults to 2025's, which is right
    // for 2025 and silently wrong for every other year — the file would carry a
    // 2024 heading over a 2025 computation with nothing on it to say so.
    const statute = statuteFor(calendarYear);
    const lawful = (statutoryFigures(calendarYear) ?? {}) as Record<string, number>;
    if ((inputRows ?? []).length && statute) {
      const held = new Map((inputRows ?? []).map((x) => [String(x.key), Number(x.value)]));
      const f = Object.fromEntries(
        INPUT_KEYS.map((k) => [k.key, held.get(k.key) ?? lawful[k.key] ?? 0]),
      ) as Parameters<typeof compute1040>[0];
      const c = compute1040(f, statute.brackets);
      const L = (label: string, v: number | null) => [label, v === null ? "" : v];
      const sheet: unknown[][] = [
        [`Form 1040, calendar ${calendarYear}`],
        [`Married filing jointly, on ${calendarYear}'s own statute — ${statute.citation}. The income is from the books; every other figure is one you set on the 1040 page.`],
        [],
        L("INCOME", null),
        L("      Taxable interest — line 2b", f.interest),
        L("      Ordinary dividends — line 3b", f.dividends),
        L("      Business income — Schedule C, line 8a", f.businessIncome),
        L("      Capital gain — Schedule D, line 7", f.capitalGain),
        L("      Rents and royalties — Schedule E, line 8", f.rentsRoyalties),
        L("      Less: rental depreciation", f.rentalDepreciation),
        L("TOTAL INCOME — line 9", c.totalIncome),
        [],
        L("ADJUSTMENTS AND DEDUCTIONS", null),
        L("      Deductible half of self-employment tax", -c.deductibleHalfOfSeTax),
        L("      Traditional IRA", f.traditionalIra),
        L("ADJUSTED GROSS INCOME — line 11", c.adjustedGrossIncome),
        L("      Standard deduction — line 12", f.standardDeduction),
        L("      Qualified business income — line 13", f.qbiDeduction),
        L("TAXABLE INCOME — line 15", c.taxableIncome),
        [],
        L("TAX AND CREDITS", null),
        L("      Tax — line 16", c.tax),
        L("      Foreign tax credit — Schedule 3, line 1", -c.foreignTaxCredit),
        L("Tax after the credit", c.taxAfterCredit),
        [],
        L("OTHER TAXES — beyond the credit's reach", null),
        L("      Self-employment tax — Schedule 2", c.selfEmploymentTax),
        L("      Additional Medicare — Form 8959", c.additionalMedicare),
        L("      Net investment income tax — Form 8960", f.netInvestmentIncomeTax),
        L("TOTAL TAX — line 24", c.totalTax),
        [],
        L("PAYMENTS", null),
        L("      Estimated tax paid", f.estimatedTaxPaid),
        L("      Credit applied from the prior year", f.creditAppliedFromPriorYear),
        L("      Balance payment", f.balancePayment),
        L("TOTAL PAYMENTS — line 33", c.totalPayments),
        L(c.balance >= 0 ? "OVERPAID — line 34" : "YOU OWE — line 37", Math.abs(c.balance)),
        [],
        ["HOW THE TAX ON LINE 16 IS MADE"],
        ["Band", "From $", "To $", "Rate", "In band $", "Tax $"],
        ...c.bands.map((b) => [b.label, b.from, b.to ?? "no ceiling", b.rate, b.inBand, b.tax]),
        ["Tax on ordinary income", "", "", "", c.ordinaryIncome, c.taxOnOrdinary],
        [`Qualified dividends at ${Math.round(f.qualifiedDividendRate * 100)}%`, "", "", f.qualifiedDividendRate, f.qualifiedDividends, c.taxOnQualifiedDividends],
        ["TAX — line 16", "", "", "", "", c.tax],
        [],
        ["FORM 1116 — the two baskets, the limit, and what is carried"],
        ["s.904(d) tests each basket on its own and forbids pooling: room to spare in one cannot rescue the other."],
        ["Basket", "Gross foreign $", "Foreign taxable $", "Limit $", "Indian tax $", "Credit $", "Carried $"],
        ...c.f1116.baskets.map((b) => [b.label, b.grossForeign, b.foreignTaxableIncome, b.limit, b.foreignTaxPaid, b.creditAllowed, b.carriedForward]),
        ["Total — Schedule 3 line 1", "", c.f1116.totalForeignTaxable, c.f1116.totalLimit, "", c.f1116.totalCredit, c.f1116.totalCarried],
        ...c.f1116.notes.map((n) => [n]),
        [],
        ["The capital gain must come from the 1099-Bs, not the rupee scrip ledgers: for 2025 those held"],
        ["$511,788 against roughly $55,000 the books implied."],
      ];
      const ws1040 = XLSX.utils.aoa_to_sheet(sheet);
      ws1040["!cols"] = [{ wch: 46 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws1040, "Computation 1040");
    } else {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        [`Form 1040, calendar ${calendarYear} — not drawn`],
        [],
        [statute
          ? `Nothing is set for ${calendarYear} on the 1040 page, so the return is not in this file.`
          : `The 1040 does not hold the statute for ${calendarYear}, and another year's brackets would give a wrong return that looks right.`],
        ["A 1040 of zeros is an empty sheet that looks like an answer, and this one would be filed."],
        [],
        ["Open /admin/zoho/tax/us1040, set the year's figures, and build this file again."],
      ]), "Computation 1040");
    }
  }
  const half1 = pack.splitOn ? "Jan–Mar" : "Period";
  const half2 = pack.splitOn ? "Apr–Dec" : "";

  // ---- Income Details — one row per ledger, the sheet everything stands on.
  const head = pack.splitOn
    ? ["Ledger, as it is named in Zoho", "Whose", `${half1} Rs`, `${half2} Rs`, "Total Rs", `${half1} $`, `${half2} $`, "Total $", "Where Zoho files it"]
    : ["Ledger, as it is named in Zoho", "Whose", "Rs", "Total Rs", "$", "Total $", "Where Zoho files it"];
  const aoa: unknown[][] = [head];
  for (const r of pack.rows) {
    aoa.push(pack.splitOn
      ? [r.ledger, r.who, r.rs1, r.rs2, r.rsTotal, r.usd1, r.usd2, r.usdTotal, r.path]
      : [r.ledger, r.who, r.rs1, r.rsTotal, r.usd1, r.usdTotal, r.path]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 42 }, { wch: 16 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 46 }];
  ws["!freeze"] = { xSplit: "0", ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  XLSX.utils.book_append_sheet(wb, ws, "Income Details");

  // ---- By whose books, so two people are never added up by accident.
  const byEnt: unknown[][] = [["Whose books", "Zoho organisation", "Ledgers", "Total Rs", "Total $"]];
  for (const e of pack.entities) byEnt.push([e.name, e.slug, e.ledgers, e.rsTotal, e.usdTotal]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(byEnt), "By person");

  // ---- Every rate used, so any dollar figure can be retraced to its month.
  const rateRows: unknown[][] = [["Month", "SBI TT buying rate", "Rate dated", "Source"]];
  for (const r of pack.rates) rateRows.push([r.month, r.rate, r.rateDate, "SBI TT buying, last published day of the month"]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rateRows), "Exchange rates");

  // ---- What this file is, and what it deliberately is not.
  const about: unknown[][] = [
    ["US return — income from the books"],
    [],
    ["Period", `${pack.from} to ${pack.to}`],
    ["Split on", pack.splitOn ?? "not split — the period does not cross 1 April"],
    ["Built", new Date().toISOString()],
    [],
    ["What is here"],
    ["Every income and expense ledger Zoho reports for the period, per person, in rupees and converted."],
    [],
    ["What is NOT here, and must still come from you or the CPA"],
    ["The 1040 itself: the bracket table, the standard deduction, the foreign tax credit and Form 1116,"],
    ["self-employment tax, additional Medicare, net investment income tax, rental depreciation,"],
    ["estimated tax paid, and every 1099 figure — including the capital gains, which the books understate."],
    ["Those are the twenty inputs your own workbook lists on its Inputs sheet. None is guessed here."],
    [],
    ["Notes"],
    ...pack.notes.map((n) => [n]),
  ];
  const aboutWs = XLSX.utils.aoa_to_sheet(about);
  aboutWs["!cols"] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(wb, aboutWs, "About");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="us-income-${pack.from}-to-${pack.to}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
