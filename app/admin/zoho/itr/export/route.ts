import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { assertArea } from "@/lib/adminAccess";
import { loadYear, fyDates, signed, bsAmount, PL_BUCKETS, BS_BUCKETS } from "@/lib/itrReturn";

// The three outputs as one workbook, so the accountant gets a file rather than
// a screenshot. It exports the SNAPSHOT — whatever the page is showing — so the
// file and the screen can never disagree.

export const dynamic = "force-dynamic";

const r0 = (n: number) => Math.round(n);

export async function GET(req: Request) {
  await assertArea("zoho");
  const fy = new URL(req.url).searchParams.get("fy") ?? "2025-26";
  if (!/^\d{4}-\d{2}$/.test(fy)) {
    return NextResponse.json({ error: "that is not a financial year" }, { status: 400 });
  }
  const { inputs, snapshot } = await loadYear(fy);
  if (!snapshot) {
    return NextResponse.json({ error: "nothing has been built for that year yet" }, { status: 404 });
  }
  const p = snapshot;
  const { to } = fyDates(fy);
  const wb = XLSX.utils.book_new();

  const add = (name: string, rows: (string | number | null)[][]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 58 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  add("Profit and loss", [
    [`Statement of profit and loss for the year ended ${to}`],
    [`Parveen Sharma — PAN AAYPS3155J — built from Zoho Books`],
    [],
    ["Particulars", "Amount (Rs.)"],
    ["Revenue from operations", r0(p.business.revenue)],
    ["Other income", r0(p.business.otherIncome)],
    ["Total income", r0(p.business.totalIncome)],
    [],
    ["Cost of goods sold", r0(p.business.cogs)],
    ["Employee benefits expense", r0(p.business.employee)],
    ["Finance costs", r0(p.business.finance)],
    ["Depreciation and amortisation expense", r0(p.business.depreciation)],
    ["Other expenses", r0(p.business.otherExpenses)],
    ["Total expenses", r0(p.business.totalExpenses)],
    [],
    ["Profit before tax", r0(p.business.profit)],
  ]);

  add("Balance sheet", [
    [`Balance sheet as at ${to}`],
    [],
    ["Particulars", "Amount (Rs.)"],
    ["ASSETS"],
    ...p.business.assets.map((a) => [`   ${a.label}`, r0(a.amount)]),
    ["Total assets", r0(p.business.totalAssets)],
    [],
    ["LIABILITIES"],
    ...p.business.liabilities.map((a) => [`   ${a.label}`, r0(a.amount)]),
    ["Total liabilities", r0(p.business.totalLiabilities)],
    [],
    ["OWNER'S CAPITAL ACCOUNT"],
    ["   Opening balance", r0(inputs.openingCapital)],
    ["   Capital introduced during the year", r0(inputs.capitalIntroduced)],
    ["   Profit for the year", r0(p.business.profit)],
    ["   Less: drawings (balancing figure)", -r0(p.business.drawings)],
    ["Closing capital", r0(p.business.closingCapital)],
  ]);

  const c = p.computation;
  add("Computation", [
    [`Computation of total income — A.Y. ${Number(fy.slice(0, 4)) + 1}-${Number(fy.slice(0, 4)) + 2}`],
    ["New regime, section 115BAC"],
    [],
    ["Particulars", "Amount (Rs.)"],
    ["1  Income from house property", r0(c.housePropertyTotal)],
    ...c.houseProperty.map((h) => [
      `   ${h.property} — annual value ${r0(h.annualValue)}, municipal tax ${r0(h.municipalTax)}, share ${h.share}%, less 30%`,
      r0(h.income),
    ]),
    ["2  Profits and gains of business or profession", r0(c.businessIncome)],
    ["3  Income from speculation business (carried forward)", r0(c.speculation)],
    ["4  Capital gains", r0(c.capitalGains.taxable)],
    ["   Gross gain per the books", r0(c.capitalGains.gross)],
    ["   Less: brought-forward loss set off", -r0(c.capitalGains.setOff)],
    ["   Loss still carried forward", r0(c.capitalGains.carriedForward)],
    ["5  Income from other sources", r0(c.otherSourcesTotal)],
    ...c.otherSources.map((o) => [`   ${o.label}`, r0(o.amount)]),
    [],
    ["Gross total income", r0(c.grossTotalIncome)],
    ["Total income (rounded off u/s 288A)", r0(c.totalIncome)],
    ["Tax on total income", r0(c.tax)],
    ["Surcharge", r0(c.surcharge)],
    ["Health and education cess at 4%", r0(c.cess)],
    ["Total tax and cess", r0(c.totalTax)],
    [],
    ["Interest u/s 234A, B and C is not computed here."],
  ]);

  add("Schedule AL", [
    [`Schedule AL — assets and liabilities at ${to}`],
    ["Assets held otherwise than as business assets. Nothing here is also in the balance sheet."],
    [],
    ["Category / ledger", "Amount (Rs.)", "Foreign currency balance"],
    ...p.scheduleAl.flatMap((cat) => [
      [cat.category, null, null],
      ...cat.rows.map((r) => [`   ${r.ledger}`, r0(r.amount), r.foreign ?? null]),
      ["   Total", r0(cat.total), null],
      [],
    ]),
  ]);

  const plLabel = Object.fromEntries(PL_BUCKETS.map((b) => [b.key, `${b.group} · ${b.label}`]));
  const bsLabel = Object.fromEntries(BS_BUCKETS.map((b) => [b.key, `${b.group} · ${b.label}`]));
  add("Ledger map", [
    ["Every ledger Zoho reported for this year, and where it was put."],
    [],
    ["Ledger", "Amount (Rs.)", "Destination"],
    ...p.pl.map((r) => [r.ledger, r0(signed(r)), r.bucket ? plLabel[r.bucket] ?? r.bucket : "NOT DECIDED"]),
    [],
    ["Balance sheet"],
    ...p.bs.map((r) => [r.ledger, r0(bsAmount(r)), r.bucket ? bsLabel[r.bucket] ?? r.bucket : "NOT DECIDED"]),
  ]);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="Return ${fy} - financials, computation and Schedule AL.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
