import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireArea } from "@/lib/adminAccess";
import { getGstSettings, computeGst } from "@/lib/invoice";
import { inChunks } from "@/lib/pageAll";
import { chosenStates, statusesFor, matchesState, type OrderTable } from "@/lib/orderStatus";

export const dynamic = "force-dynamic";
// THE DOWNLOAD THAT ENDED IN "RELOAD WEBSITE / TRY AGAIN".
//
// No maximum was ever set here, so this ran under the default ten seconds while
// reading three tables at five thousand rows each and then every buyer's course
// list on top. It went over, the platform killed it mid-response, and the
// browser showed its own error page instead of a file. The Razorpay export next
// door had always declared sixty.
export const maxDuration = 300;

// Excel-ready CSV of OUR OWN website sales — subscriptions/extensions (orders)
// and book orders — from our database, one row per sale: name, level, phone,
// email, address, GSTIN, taxable value (without GST), GST amount, total paid.
// Razorpay-account data has its own export at /admin/orders/razorpay/export.
type Ship = { name?: string; line1?: string; line2?: string; city?: string; state?: string; pincode?: string; phone?: string };
type Contact = { name?: string; email?: string; phone?: string };

/** Whole months between two dates — what the student actually bought. */
function monthsBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const from = new Date(a), to = new Date(b);
  const m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return m > 0 ? m : null;
}

export async function GET(req: NextRequest) {
  // The page is open to anyone with the sales area; the download of what is on
  // that page was admins-only, so an operator who could read every order on
  // screen got "Admins only" the moment they pressed the button.
  if (!(await requireArea("store"))) {
    return new NextResponse("You do not have rights to the sales area.", { status: 403 });
  }

  const svc = createServiceClient();
  const s = await getGstSettings();

  // Same date range as the page, so "export what I am looking at" holds true.
  const sp = req.nextUrl.searchParams;
  const okDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const fromDay = okDate(sp.get("from"));
  const toDay = okDate(sp.get("to"));
  const fromIso = fromDay ? new Date(`${fromDay}T00:00:00+05:30`).toISOString() : null;
  const toIso = toDay ? new Date(`${toDay}T23:59:59+05:30`).toISOString() : null;

  // WHICH STATUSES TO INCLUDE.
  //
  // The download always carried every order, so a file meant to be a record of
  // takings also held the attempts that were never paid for — and the total at
  // the bottom of the spreadsheet was not money we had. Pick "paid" and the
  // file holds paid orders and nothing else.
  // Each table is asked in its own vocabulary — a finished supporter sale is
  // "provisioned", never "paid", so ticking Paid used to exclude every vendor
  // order in the business. See lib/orderStatus.ts.
  const chosen = chosenStates(sp.get("status"));
  const applyStatus = <T extends { in: (col: string, v: string[]) => T }>(q: T, table: OrderTable): T =>
    chosen.length ? q.in("status", statusesFor(table, chosen)) : q;

  const [{ data: orderRows }, { data: bookRows }, { data: giftRows }] = await Promise.all([
    (() => {
      let q = svc.from("orders")
        .select("kind, amount_inr, status, created_at, invoice_no, order_no, subject_id, subjects:subject_id(title, courses(title)), profiles:student_id(id, full_name, email, phone, state, gstin, address_line1, address_line2, city, pincode)");
      if (fromIso) q = q.gte("created_at", fromIso);
      if (toIso) q = q.lte("created_at", toIso);
      q = applyStatus(q as never, "orders") as never;
      return q.order("created_at", { ascending: false }).limit(5000);
    })(),
    (() => {
      let q = svc.from("book_orders")
        .select("amount_inr, status, created_at, guest_contact, ship_to, invoice_no, order_no");
      if (fromIso) q = q.gte("created_at", fromIso);
      if (toIso) q = q.lte("created_at", toIso);
      return q.order("created_at", { ascending: false }).limit(5000);
    })(),
    // Supporter sales belong in the register, and so in the download.
    (() => {
      let q = svc.from("gift_orders")
        .select("amount_inr, discount_inr, coupon_code, status, created_at, invoice_no, order_no, months, tier, recipient_name, recipient_email, recipient_phone, billing_state, subjects:subject_id(title, courses(title)), gifter:gifter_id(full_name, email, business_name, designation, is_supporter)");
      if (fromIso) q = q.gte("created_at", fromIso);
      if (toIso) q = q.lte("created_at", toIso);
      q = applyStatus(q as never, "gift_orders") as never;
      return q.order("created_at", { ascending: false }).limit(5000);
    })(),
  ]);

  type OrderProf = { id: string; full_name: string | null; email: string | null; phone: string | null; state: string | null; gstin: string | null; address_line1: string | null; address_line2: string | null; city: string | null; pincode: string | null };
  const subs = (orderRows ?? []) as unknown as { kind: string; amount_inr: number; status: string; created_at: string; invoice_no: string | null; order_no: number | null; subject_id: string | null; subjects: { title: string; courses?: { title?: string } | { title?: string }[] | null } | null; profiles: OrderProf | null }[];

  // Level (Final / Inter) + subscription dates from each buyer's records.
  const ids = [...new Set(subs.map((o) => o.profiles?.id).filter(Boolean))] as string[];
  const levelByUser = new Map<string, string>();
  const subDates = new Map<string, { starts_at: string | null; ends_at: string | null; tier: string | null }>();
  if (ids.length) {
    // In batches. One .in() over every buyer is a URL the server refuses, and a
    // refused query here empties the level and date columns of the export
    // without a word.
    const [mc, subRows] = await Promise.all([
      inChunks<{ student_id: string; courses?: { title?: string } | null }>(ids, (b) =>
        svc.from("my_courses").select("student_id, courses(title)").in("student_id", b) as never),
      inChunks<{ student_id: string; subject_id: string | null; starts_at: string | null; ends_at: string | null; created_at: string; plans?: { tier?: string } | null }>(ids, (b) =>
        svc.from("subscriptions").select("student_id, subject_id, starts_at, ends_at, created_at, plans(tier)").in("student_id", b).order("created_at") as never),
    ]);
    for (const r of mc) {
      const t = ((r as { courses?: { title?: string } | null }).courses?.title ?? "").toLowerCase();
      const lvl = t.includes("final") ? "Final" : t.includes("inter") ? "Inter" : "";
      if (!lvl) continue;
      const cur = levelByUser.get(r.student_id as string);
      levelByUser.set(r.student_id as string, cur && cur !== lvl ? "Final + Inter" : lvl);
    }
    for (const s of subRows ?? []) {
      const tier = ((s as { plans?: { tier?: string } | null }).plans?.tier ?? null) as string | null;
      subDates.set(`${s.student_id}:${s.subject_id}`, {
        starts_at: s.starts_at as string | null,
        ends_at: s.ends_at as string | null,
        tier,
      });
    }
  }

  const courseLevel = (subj: { courses?: { title?: string } | { title?: string }[] | null } | null): string => {
    const c = subj?.courses;
    const t = ((Array.isArray(c) ? c[0]?.title : c?.title) ?? "").toLowerCase();
    return t.includes("final") ? "Final" : t.includes("inter") ? "Inter" : t.includes("foundation") ? "Foundation" : "";
  };

  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const dt = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const d = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
  // WHERE THE ORDER CAME FROM, in one column, in words.
  //
  // Three things were indistinguishable in this file: a student buying for
  // themselves, a vendor selling to a student, and a student sponsoring
  // somebody else. The last two are the same table and differ only by whether
  // the buyer is a registered supporter, so the file said "supporter sale" for
  // both and named nobody.
  const sourceOfGift = (g: GiftExport): string => {
    const job = g.gifter?.designation ? ` (${g.gifter.designation})` : "";
    const who = (g.gifter?.business_name || g.gifter?.full_name || g.gifter?.email || "") + (g.gifter?.business_name || g.gifter?.full_name || g.gifter?.email ? job : "");
    return g.gifter?.is_supporter
      ? `Vendor order${who ? ` — ${who}` : ""}`
      : `Student sponsored${who ? ` — ${who}` : ""}`;
  };

  const rows = [[
    "Order no", "Date", "Order source", "Sale type", "Subject", "Plan", "Months", "Status", "Invoice no",
    "Name", "Level", "Phone", "Email",
    "Address", "GSTIN", "Subscription start", "Subscription end",
    "Amount without GST", "GST amount", "Total paid (Rs)", "Sold by", "Coupon", "Discount (Rs)",
  ].join(",")];

  for (const o of subs) {
    const pr = o.profiles;
    const gst = computeGst(o.amount_inr ?? 0, pr?.state ?? "", s);
    const address = pr ? [pr.address_line1, pr.address_line2, [pr.city, pr.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
    const dates = pr && o.subject_id ? subDates.get(`${pr.id}:${o.subject_id}`) : undefined;
    rows.push([
      esc(o.order_no != null ? `#${o.order_no}` : ""),
      esc(dt(o.created_at)), esc("Direct student order"), esc(o.kind), esc(o.subjects?.title ?? ""),
      // Gold / Silver / Bronze — the thing the plan column exists for.
      esc(dates?.tier ? dates.tier.charAt(0).toUpperCase() + dates.tier.slice(1) : ""),
      // How many months they actually bought, from the subscription's own dates.
      esc(monthsBetween(dates?.starts_at, dates?.ends_at) ?? ""),
      esc(o.status), esc(o.invoice_no ?? ""),
      // From the order's OWN course, not from everything the buyer holds —
      // otherwise a CA Final order under a buyer who also has Inter is
      // exported as "Inter" beside the Final subject.
      esc(pr?.full_name ?? ""), esc(courseLevel(o.subjects) || (pr ? levelByUser.get(pr.id) ?? "" : "")),
      esc(pr?.phone ?? ""), esc(pr?.email ?? ""), esc(address), esc(pr?.gstin ?? ""),
      esc(d(dates?.starts_at)), esc(d(dates?.ends_at)),
      esc(gst.taxable.toFixed(2)), esc((gst.cgst + gst.sgst + gst.igst).toFixed(2)),
      esc((o.amount_inr ?? 0).toFixed(2)), esc(""), esc(""), esc(""),
    ].join(","));
  }

  for (const b of ((bookRows ?? []) as unknown as { amount_inr: number; status: string; created_at: string; guest_contact: Contact | null; ship_to: Ship | null; invoice_no: string | null; order_no: number | null }[])
    .filter((b) => matchesState("book_orders", chosen, b.status))) {
    const ship = b.ship_to ?? {};
    const gst = computeGst(b.amount_inr ?? 0, ship.state ?? "", s);
    const address = [ship.line1, ship.line2, [ship.city, ship.state, ship.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    rows.push([
      esc(b.order_no != null ? `#${b.order_no}` : ""),
      esc(dt(b.created_at)), esc("Direct student order"), esc("book order"), esc(""), esc(""), esc(""), esc(b.status), esc(b.invoice_no ?? ""),
      esc(b.guest_contact?.name ?? ship.name ?? ""), esc(""),
      esc(b.guest_contact?.phone ?? ship.phone ?? ""), esc(b.guest_contact?.email ?? ""),
      esc(address), esc(""), esc(""), esc(""),
      esc(gst.taxable.toFixed(2)), esc((gst.cgst + gst.sgst + gst.igst).toFixed(2)),
      esc((b.amount_inr ?? 0).toFixed(2)), esc(""), esc(""), esc(""),
    ].join(","));
  }

  // Supporter sales — the same columns, plus who sold it and what they took off.
  type GiftExport = {
    amount_inr: number; discount_inr: number | null; coupon_code: string | null;
    status: string; created_at: string; invoice_no: string | null; order_no: number | null;
    months: number | null; tier: string | null; billing_state: string | null;
    recipient_name: string | null; recipient_email: string | null; recipient_phone: string | null;
    subjects: { title: string; courses?: { title?: string } | { title?: string }[] | null } | null;
    gifter: { full_name: string | null; email: string | null; business_name: string | null; designation: string | null; is_supporter: boolean | null } | null;
  };
  for (const g of (giftRows ?? []) as unknown as GiftExport[]) {
    const gst = computeGst(g.amount_inr ?? 0, g.billing_state ?? "", s);
    rows.push([
      esc(g.order_no != null ? `#${g.order_no}` : ""),
      esc(dt(g.created_at)), esc(sourceOfGift(g)),
      esc(g.gifter?.is_supporter ? "vendor sale" : "sponsorship"),
      esc(g.subjects?.title ?? ""),
      esc(g.tier ? g.tier.charAt(0).toUpperCase() + g.tier.slice(1) : ""),
      esc(g.months ?? ""),
      esc(g.status), esc(g.invoice_no ?? ""),
      esc(g.recipient_name ?? ""), esc(courseLevel(g.subjects)),
      esc(g.recipient_phone ?? ""), esc(g.recipient_email ?? ""),
      esc(""), esc(""), esc(""), esc(""),
      esc(gst.taxable.toFixed(2)), esc((gst.cgst + gst.sgst + gst.igst).toFixed(2)),
      esc((g.amount_inr ?? 0).toFixed(2)),
      esc([g.gifter?.business_name || g.gifter?.full_name || g.gifter?.email || "", g.gifter?.designation].filter(Boolean).join(" · ")),
      esc(g.coupon_code ?? ""), esc(g.discount_inr != null ? g.discount_inr.toFixed(2) : ""),
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
