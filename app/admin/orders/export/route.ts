import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getGstSettings, computeGst } from "@/lib/invoice";

export const dynamic = "force-dynamic";

// Excel-ready CSV of OUR OWN website sales — subscriptions/extensions (orders)
// and book orders — from our database, one row per sale: name, level, phone,
// email, address, GSTIN, taxable value (without GST), GST amount, total paid.
// Razorpay-account data has its own export at /admin/orders/razorpay/export.
type Ship = { name?: string; line1?: string; line2?: string; city?: string; state?: string; pincode?: string; phone?: string };
type Contact = { name?: string; email?: string; phone?: string };

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Login required", { status: 401 });
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return new NextResponse("Admins only", { status: 403 });

  const svc = createServiceClient();
  const s = await getGstSettings();

  const [{ data: orderRows }, { data: bookRows }] = await Promise.all([
    svc.from("orders")
      .select("kind, amount_inr, status, created_at, invoice_no, profiles:student_id(id, full_name, email, phone, state, gstin, address_line1, address_line2, city, pincode)")
      .order("created_at", { ascending: false }).limit(1000),
    svc.from("book_orders")
      .select("amount_inr, status, created_at, guest_contact, ship_to, invoice_no")
      .order("created_at", { ascending: false }).limit(1000),
  ]);

  type OrderProf = { id: string; full_name: string | null; email: string | null; phone: string | null; state: string | null; gstin: string | null; address_line1: string | null; address_line2: string | null; city: string | null; pincode: string | null };
  const subs = (orderRows ?? []) as unknown as { kind: string; amount_inr: number; status: string; created_at: string; invoice_no: string | null; profiles: OrderProf | null }[];

  // Level (Final / Inter) from each buyer's course shelf.
  const ids = [...new Set(subs.map((o) => o.profiles?.id).filter(Boolean))] as string[];
  const levelByUser = new Map<string, string>();
  if (ids.length) {
    const { data: mc } = await svc.from("my_courses").select("student_id, courses(title)").in("student_id", ids);
    for (const r of mc ?? []) {
      const t = ((r as { courses?: { title?: string } | null }).courses?.title ?? "").toLowerCase();
      const lvl = t.includes("final") ? "Final" : t.includes("inter") ? "Inter" : "";
      if (!lvl) continue;
      const cur = levelByUser.get(r.student_id as string);
      levelByUser.set(r.student_id as string, cur && cur !== lvl ? "Final + Inter" : lvl);
    }
  }

  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const dt = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const rows = [[
    "Date", "Sale type", "Status", "Invoice no", "Name", "Level", "Phone", "Email",
    "Address", "GSTIN", "Amount without GST", "GST amount", "Total paid (Rs)",
  ].join(",")];

  for (const o of subs) {
    const pr = o.profiles;
    const gst = computeGst(o.amount_inr ?? 0, pr?.state ?? "", s);
    const address = pr ? [pr.address_line1, pr.address_line2, [pr.city, pr.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
    rows.push([
      esc(dt(o.created_at)), esc(o.kind), esc(o.status), esc(o.invoice_no ?? ""),
      esc(pr?.full_name ?? ""), esc(pr ? levelByUser.get(pr.id) ?? "" : ""),
      esc(pr?.phone ?? ""), esc(pr?.email ?? ""), esc(address), esc(pr?.gstin ?? ""),
      esc(gst.taxable.toFixed(2)), esc((gst.cgst + gst.sgst + gst.igst).toFixed(2)),
      esc((o.amount_inr ?? 0).toFixed(2)),
    ].join(","));
  }

  for (const b of (bookRows ?? []) as unknown as { amount_inr: number; status: string; created_at: string; guest_contact: Contact | null; ship_to: Ship | null; invoice_no: string | null }[]) {
    const ship = b.ship_to ?? {};
    const gst = computeGst(b.amount_inr ?? 0, ship.state ?? "", s);
    const address = [ship.line1, ship.line2, [ship.city, ship.state, ship.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    rows.push([
      esc(dt(b.created_at)), esc("book order"), esc(b.status), esc(b.invoice_no ?? ""),
      esc(b.guest_contact?.name ?? ship.name ?? ""), esc(""),
      esc(b.guest_contact?.phone ?? ship.phone ?? ""), esc(b.guest_contact?.email ?? ""),
      esc(address), esc(""),
      esc(gst.taxable.toFixed(2)), esc((gst.cgst + gst.sgst + gst.igst).toFixed(2)),
      esc((b.amount_inr ?? 0).toFixed(2)),
    ].join(","));
  }

  return new NextResponse("﻿" + rows.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="website-sales-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
