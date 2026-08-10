import { formatDateTime } from "@/lib/dates";
import { NextResponse, type NextRequest } from "next/server";
import { requireArea } from "@/lib/adminAccess";
import { listDispatchQueue } from "@/lib/warehouse";

export const dynamic = "force-dynamic";
// Reading three tables and a book list. Well inside a minute, but the default
// ten seconds is not something to find out about while somebody is packing.
export const maxDuration = 120;

// THE PACKING LIST, AS A SPREADSHEET.
//
// The screen is for working through parcels one at a time — print the labels,
// enter a tracking ID. A spreadsheet is for the other half of the job: handing
// a courier a day's consignments, checking last month's dispatches against an
// invoice, keeping a record that outlives the queue.
//
// City, state and PIN get their own columns. A courier's own upload sheet sorts
// on a PIN code, and one address column would mean somebody retyping four
// hundred of them by hand.
//
//   ?which=pending     awaiting dispatch (the default)
//   ?which=dispatched  already gone, with tracking IDs
//   ?which=all         both
//   &q=…               the same search as the page, so the file matches the screen

export async function GET(req: NextRequest) {
  // The same right as the page. A warehouse packer has this area and nothing
  // else; the download of what they are packing must not be admins-only, which
  // is precisely the mistake the sales export had.
  if (!(await requireArea("warehouse"))) {
    return new NextResponse("You do not have rights to the warehouse.", { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const which = (sp.get("which") ?? "pending").toLowerCase();
  const q = (sp.get("q") ?? "").trim().toLowerCase();

  const all = await listDispatchQueue(false);
  const match = (s: (string | null)[]) => !q || s.some((x) => (x ?? "").toLowerCase().includes(q));
  const searched = all.filter((i) => match([i.orderNo, i.name, i.phone, i.contents, i.tracking]));

  const rows =
    which === "dispatched" ? searched.filter((i) => i.tracking)
    : which === "all" ? searched
    : searched.filter((i) => !i.tracking);

  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const day = (iso: string) =>
    formatDateTime(iso);

  // What the parcel is, in the words the office uses rather than a table name.
  const kind = (t: string) =>
    t === "book_orders" ? "Book order"
    : t === "gift_orders" ? "Vendor / sponsored — free book set"
    : "Gold plan — free book set";

  const out = [[
    "Order no", "Ordered on", "Parcel", "Send to", "Phone",
    "Address", "City", "State", "PIN code",
    "Contents", "Status", "Tracking ID",
  ].join(",")];

  for (const i of rows) {
    out.push([
      esc(i.orderNo), esc(day(i.createdAt)), esc(kind(i.table)),
      esc(i.name), esc(i.phone),
      esc(i.address), esc(i.city), esc(i.state), esc(i.pincode),
      esc(i.contents),
      esc(i.tracking ? "Dispatched" : "Awaiting dispatch"),
      esc(i.tracking ?? ""),
    ].join(","));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const name = which === "dispatched" ? "dispatched" : which === "all" ? "all-parcels" : "to-dispatch";
  return new NextResponse("﻿" + out.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="warehouse-${name}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
