import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import { requireArea } from "@/lib/adminAccess";
import { listDispatchQueue } from "@/lib/warehouse";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// THE INVOICES FOR THE PARCELS BEING PACKED — AND ONLY THOSE.
//
// A tax invoice goes in the box with the books. The warehouse could not get at
// one: invoices live under Sales & orders, which is the store area, so a packer
// had to ask an admin for every single parcel, and the admin had to find it
// among every sale the business has ever made.
//
// So this takes the same dispatch queue the packer is already looking at,
// filtered by the same dates, and staples those invoices — and no others —
// into one PDF to print. It never opens the door to the whole invoice book:
// what comes out is exactly what is going in a box today.

export async function GET(req: NextRequest) {
  if (!(await requireArea("warehouse"))) {
    return new NextResponse("You do not have rights to the warehouse.", { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const okDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const fromDay = okDate(sp.get("from"));
  const toDay = okDate(sp.get("to"));
  const fromMs = fromDay ? new Date(`${fromDay}T00:00:00+05:30`).getTime() : null;
  const toMs = toDay ? new Date(`${toDay}T23:59:59+05:30`).getTime() : null;
  // Which parcels: still to go out (the default) or everything in the range.
  const all = sp.get("which") === "all";

  const queue = (await listDispatchQueue(!all)).filter((q) => {
    const at = new Date(q.createdAt).getTime();
    if (fromMs !== null && at < fromMs) return false;
    if (toMs !== null && at > toMs) return false;
    return true;
  });

  const withInvoice = queue.filter((q) => q.invoiceUrl);
  if (!withInvoice.length) {
    const none = queue.length
      ? `${queue.length} parcel(s) here, but none has an invoice raised yet. Ask the office to generate them under Sales & orders.`
      : "No parcels in that date range.";
    return new NextResponse(none, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  // Stapled into one file: a packer prints once and works down the pile,
  // rather than opening and printing thirty separate tabs.
  const out = await PDFDocument.create();
  const missed: string[] = [];
  for (const q of withInvoice) {
    try {
      const res = await fetch(q.invoiceUrl!, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!res.ok) { missed.push(q.orderNo); continue; }
      const src = await PDFDocument.load(await res.arrayBuffer());
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    } catch {
      // One unreachable invoice must not lose the other twenty-nine.
      missed.push(q.orderNo);
    }
  }

  if (out.getPageCount() === 0) {
    return new NextResponse(
      "None of the invoices could be fetched. They may still be generating — try again in a minute.",
      { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const stamp = fromDay || new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(await out.save()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoices-to-ship-${stamp}.pdf"`,
      "Cache-Control": "no-store",
      // Said out loud rather than silently dropped, so nobody ships a parcel
      // believing its invoice is in the pile when it is not.
      ...(missed.length ? { "X-Invoices-Missing": missed.join(" ") } : {}),
    },
  });
}
