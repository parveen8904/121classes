import { NextRequest, NextResponse } from "next/server";
import { requireArea } from "@/lib/adminAccess";
import { listRazorpayPayments } from "@/lib/razorpay";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Excel-ready CSV of Razorpay-account collections, honouring the same options
// as /admin/orders/razorpay (days / status / method). This is CROSS-CHECK data:
// the same Razorpay key is used outside this website, so rows here are not
// necessarily this website's sales.
export async function GET(req: NextRequest) {
  // Same rights as the page this downloads: an operator who may read the sales
  // area may take a copy of what they are reading.
  if (!(await requireArea("store"))) {
    return new NextResponse("You do not have rights to the sales area.", { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const days = Math.min(365, Math.max(1, parseInt(sp.get("days") ?? "90", 10) || 90));
  const status = sp.get("status") && sp.get("status") !== "all" ? sp.get("status")! : "";
  const method = sp.get("method") && sp.get("method") !== "all" ? sp.get("method")! : "";
  const okDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const from = okDate(sp.get("from")), to = okDate(sp.get("to"));

  let payments;
  try { payments = (await listRazorpayPayments(days, 5000, { from, to })).payments; }
  catch { return new NextResponse("Could not reach Razorpay — check the keys and try again.", { status: 502 }); }
  if (status) payments = payments.filter((p) => p.status === status);
  if (method) payments = payments.filter((p) => p.method === method);

  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const rows = [["Date", "Payment ID", "Status", "Method", "Email", "Phone", "Description", "Amount (Rs)"].join(",")];
  for (const p of payments) {
    rows.push([
      esc(new Date(p.created_at * 1000).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })),
      esc(p.id), esc(p.status), esc(p.method), esc(p.email || ""), esc(p.contact || ""),
      esc(p.description || p.notes?.kind || ""),
      esc(((p.amount || 0) / 100).toFixed(2)),
    ].join(","));
  }

  return new NextResponse("﻿" + rows.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="razorpay-${from || to ? `${from || "start"}_to_${to || "today"}` : `${days}d`}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
