import { NextResponse, type NextRequest } from "next/server";
import { requireArea } from "@/lib/adminAccess";
import { accountRows, invoicesCsv, paymentsCsv } from "@/lib/accountsExport";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";
// Reading three tables and composing a file. Well inside a minute, but the
// default ten seconds is not something to discover while closing the books.
export const maxDuration = 300;

// TWO FILES FOR THE ACCOUNTS DEPARTMENT, AND NEITHER IS THE SALES EXPORT.
//
//   ?what=invoices  the documents raised
//   ?what=payments  the money received against them
//
// Zoho Books imports those separately and they cannot be one file. Filters
// carry over from the screen, so the file matches what was on it.
//
// The existing sales export at /admin/orders/export is untouched by any of
// this — different route, different query, different columns.
export async function GET(req: NextRequest) {
  if (!(await requireArea("store"))) {
    return new NextResponse("You do not have rights to sales and orders.", { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const what = sp.get("what") === "payments" ? "payments" : "invoices";
  const filter = {
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    state: sp.get("state") ?? undefined,
    zoho: sp.get("zoho") ?? undefined,
  };

  const rows = await accountRows(filter);
  const depositTo = (await getSecret("ZOHO_DEPOSIT_TO")) || "Razorpay Clearing";
  const body = what === "payments" ? paymentsCsv(rows, 1, depositTo) : invoicesCsv(rows);

  const span = [filter.from, filter.to].filter(Boolean).join("_to_") || new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="zoho-${what}-${span}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
