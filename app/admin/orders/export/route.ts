import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { listRazorpayPayments } from "@/lib/razorpay";
import { getGstSettings, computeGst } from "@/lib/invoice";

export const dynamic = "force-dynamic";

// Excel-ready CSV of EVERY Razorpay collection (site checkouts, payment links,
// QR/UPI — everything), one row per payment: name, level, phone, email,
// address, GSTIN, taxable value (without GST), GST amount, total paid.
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Login required", { status: 401 });
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return new NextResponse("Admins only", { status: 403 });

  let payments;
  try { payments = await listRazorpayPayments(365, 100); }
  catch { return new NextResponse("Could not reach Razorpay — check the keys and try again.", { status: 502 }); }

  const svc = createServiceClient();
  const s = await getGstSettings();

  // Match payers to student profiles by email (level, address, GSTIN).
  const emails = [...new Set(payments.map((p) => (p.email || "").toLowerCase()).filter(Boolean))];
  const { data: profs } = emails.length
    ? await svc.from("profiles").select("id, email, full_name, phone, state, gstin, address_line1, address_line2, city, pincode").in("email", emails)
    : { data: [] as never[] };
  const profByEmail = new Map((profs ?? []).map((p) => [String(p.email).toLowerCase(), p]));
  const ids = (profs ?? []).map((p) => p.id as string);
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
  const rows = [[
    "Date", "Payment ID", "Status", "Method", "Name", "Level", "Phone", "Email",
    "Address", "GSTIN", "Description", "Amount without GST", "GST amount", "Total paid (Rs)", "Discount",
  ].join(",")];

  for (const p of payments) {
    const total = (p.amount || 0) / 100;
    const pr = profByEmail.get((p.email || "").toLowerCase());
    const gst = computeGst(total, (pr?.state as string) || "", s);
    const address = pr ? [pr.address_line1, pr.address_line2, [pr.city, pr.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
    rows.push([
      esc(new Date(p.created_at * 1000).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })),
      esc(p.id), esc(p.status), esc(p.method),
      esc((pr?.full_name as string) || p.notes?.name || ""),
      esc(pr ? levelByUser.get(pr.id as string) ?? "" : ""),
      esc((pr?.phone as string) || p.contact || ""),
      esc(p.email || ""),
      esc(address),
      esc((pr?.gstin as string) || ""),
      esc(p.description || p.notes?.kind || ""),
      esc(gst.taxable.toFixed(2)),
      esc((gst.cgst + gst.sgst + gst.igst).toFixed(2)),
      esc(total.toFixed(2)),
      esc(""), // discount is not recorded by Razorpay; site coupons apply before payment
    ].join(","));
  }

  return new NextResponse("﻿" + rows.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
