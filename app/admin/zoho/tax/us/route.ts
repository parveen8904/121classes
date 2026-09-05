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
