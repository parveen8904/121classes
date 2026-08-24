"use server";

import { requireArea, currentStaff } from "@/lib/adminAccess";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { runWarehouseDispatch } from "@/lib/warehouse";
import { str } from "../_lib/util";

export async function setOrderStatus(formData: FormData) {
  if (!(await requireArea("store"))) return;
  const id = str(formData.get("id"));
  const status = str(formData.get("status"));
  if (!id || !["paid", "dispatched", "delivered", "cancelled"].includes(status)) return;
  const supabase = createServiceClient();
  await supabase.from("book_orders").update({ status }).eq("id", id);
  revalidatePath("/admin/orders");
}

// Team approval for Zoho: only sales approved here are posted to Zoho Books
// (by the nightly cron) — so a mistaken sale never reaches the books.
export async function approveForZoho(formData: FormData) {
  if (!(await requireArea("store"))) return;
  const id = str(formData.get("id"));
  const table = str(formData.get("table"));
  if (!id || !["orders", "book_orders"].includes(table)) return;
  const supabase = createServiceClient();
  await supabase.from(table).update({ zoho_status: "approved" }).eq("id", id).eq("zoho_status", "pending");
  revalidatePath("/admin/orders");
}

// One-click day approval: everything of a calendar date (IST) goes to Zoho at
// once. Fishy sales: press Hold on that row FIRST — held rows are excluded
// here and never post.
export async function approveDayForZoho(formData: FormData) {
  if (!(await requireArea("store"))) return;
  const day = str(formData.get("day")); // YYYY-MM-DD (IST calendar date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  const start = new Date(`${day}T00:00:00+05:30`).toISOString();
  const end = new Date(new Date(start).getTime() + 24 * 3600 * 1000).toISOString();
  const supabase = createServiceClient();
  await supabase.from("orders").update({ zoho_status: "approved" })
    .eq("zoho_status", "pending").eq("status", "paid")
    .gte("created_at", start).lt("created_at", end);
  await supabase.from("book_orders").update({ zoho_status: "approved" })
    .eq("zoho_status", "pending").neq("status", "cancelled")
    .gte("created_at", start).lt("created_at", end);
  revalidatePath("/admin/orders");
}

// Accountant's bulk push: approve every ticked sale for tonight's Zoho run.
// Checkboxes live outside this form (form= attribute) so they never nest
// inside the per-row action forms.
export async function approveSelectedForZoho(formData: FormData) {
  if (!(await requireArea("store"))) return;
  const ids = formData.getAll("zoho_ids").map(String);
  const supabase = createServiceClient();
  for (const t of ["orders", "book_orders"] as const) {
    const rows = ids.filter((v) => v.startsWith(`${t}:`)).map((v) => v.slice(t.length + 1)).filter(Boolean);
    if (rows.length) {
      await supabase.from(t).update({ zoho_status: "approved" }).in("id", rows).eq("zoho_status", "pending");
    }
  }
  revalidatePath("/admin/orders");
}

// Manually (re)issue the invoice+receipt PDF for a paid sale the system
// missed (e.g. a backfilled ledger row). Idempotent — does nothing if the
// sale already has an invoice number.
export async function generateInvoice(formData: FormData) {
  if (!(await requireArea("store"))) return;
  const id = str(formData.get("id"));
  const table = str(formData.get("table"));
  if (!id || !["orders", "book_orders"].includes(table)) return;
  const svc = createServiceClient();
  const { issueOrderInvoice } = await import("@/lib/orderInvoice");
  if (table === "orders") {
    const { data: o } = await svc
      .from("orders")
      .select("razorpay_order_id, student_id, amount_inr, status, invoice_no, kind, subjects:subject_id(title), profiles:student_id(full_name, email)")
      .eq("id", id).maybeSingle();
    const row = o as unknown as { razorpay_order_id: string | null; student_id: string; amount_inr: number; status: string; invoice_no: string | null; kind: string; subjects: { title: string } | null; profiles: { full_name: string | null; email: string | null } | null } | null;
    if (!row || row.invoice_no || row.status !== "paid" || !row.razorpay_order_id) return;
    await issueOrderInvoice({
      razorpayOrderId: row.razorpay_order_id,
      payerUserId: row.student_id,
      payerName: row.profiles?.full_name ?? null,
      payerEmail: row.profiles?.email ?? null,
      description: `Coaching: ${row.subjects?.title ?? "Online classes"} — ${row.kind}`,
      amountInr: row.amount_inr ?? 0,
      table: "orders",
    });
  } else {
    const { data: b } = await svc
      .from("book_orders")
      .select("razorpay_order_id, amount_inr, status, invoice_no, guest_contact")
      .eq("id", id).maybeSingle();
    const row = b as unknown as { razorpay_order_id: string | null; amount_inr: number; status: string; invoice_no: string | null; guest_contact: { name?: string; email?: string } | null } | null;
    if (!row || row.invoice_no || row.status === "cancelled" || !row.razorpay_order_id) return;
    await issueOrderInvoice({
      razorpayOrderId: row.razorpay_order_id,
      payerName: row.guest_contact?.name ?? null,
      payerEmail: row.guest_contact?.email ?? null,
      description: "Books order",
      amountInr: row.amount_inr ?? 0,
      table: "book_orders",
    });
  }
  revalidatePath("/admin/orders");
}

// Hold a fishy sale (never posts, excluded from day-approval) / release it.
export async function holdForZoho(formData: FormData) {
  if (!(await requireArea("store"))) return;
  const id = str(formData.get("id"));
  const table = str(formData.get("table"));
  const to = str(formData.get("to")); // "skipped" (hold) or "pending" (release)
  if (!id || !["orders", "book_orders"].includes(table) || !["skipped", "pending"].includes(to)) return;
  const supabase = createServiceClient();
  await supabase.from(table).update({ zoho_status: to })
    .eq("id", id).in("zoho_status", ["pending", "skipped"]);
  revalidatePath("/admin/orders");
}

// Manually email the warehouse the current paid-but-unshipped orders.
export async function sendDispatchEmail() {
  if (!(await requireArea("store"))) return;
  const r = await runWarehouseDispatch();
  revalidatePath("/admin/orders");
  redirect(`/admin/orders?dispatch=${r.skipped ? "skipped" : r.count}`);
}

/**
 * SEND ONE COPY TO MYSELF, AND CHANGE NOTHING.
 *
 * Checking what the warehouse is about to be sent used to mean either sending
 * it to them for real, or holding the CRON_SECRET and calling the endpoint by
 * hand. Neither is a reasonable way to answer "does the spreadsheet look
 * right?", so this sends exactly the same email — same list, same workbook — to
 * the address of whoever pressed it, and to nobody else.
 *
 * It does NOT stamp anything. A test that marked the parcels as reported would
 * delete them from the real list the packer is waiting for, which is the one
 * mistake this button must never make.
 */
export async function sendDispatchTestToMe() {
  if (!(await requireArea("store"))) return;
  const me = await currentStaff();
  const { createServiceClient: svcClient } = await import("@/lib/supabase/service");
  const { data: prof } = me
    ? await svcClient().from("profiles").select("email").eq("id", me.id).maybeSingle()
    : { data: null };
  const to = String((prof as { email?: string } | null)?.email ?? "").trim();
  if (!to) redirect(`/admin/orders?dispatch=${encodeURIComponent("no email on your own account to send a test to")}`);

  const { ordersForDay, parcelsOnly, dispatchWorkbook, dayReportHtml, istToday } = await import("@/lib/dayOrderReport");
  const { sendEmailWithAttachment, emailShell } = await import("@/lib/notify");
  // TODAY'S orders, on the same 00:00–00:00 IST rule as the nightly mail — one
  // window everywhere, so the button and the cron can never disagree.
  const label = istToday();
  const rows = parcelsOnly(await ordersForDay(label));
  const subject = `[TEST] \u{1F4E6} ${rows.length} parcel(s) to pack`;
  const ok = await sendEmailWithAttachment(
    to, subject, emailShell(subject, dayReportHtml(label, rows)), await dispatchWorkbook(rows, label),
  ).catch(() => false);

  redirect(`/admin/orders?dispatch=${encodeURIComponent(
    ok ? `test sent to ${to} — ${rows.length} parcel(s), nothing marked as reported`
       : "the test email could not be sent — check Mailgun on Integrations",
  )}`);
}

/**
 * Put right an invoice that was issued wrong.
 *
 * Same number, same date, same amount — only the address and the tax split are
 * corrected, from whatever the student's profile now holds. It refuses if that
 * profile still has no complete address, because replacing one defective tax
 * invoice with another helps nobody. The corrected copy is emailed to the
 * student with a plain explanation.
 */
export async function reissueInvoice(formData: FormData): Promise<void> {
  if (!(await requireArea("store"))) return;
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return;
  const { reissueOrderInvoice } = await import("@/lib/orderInvoice");
  await reissueOrderInvoice(orderId);
  revalidatePath("/admin/orders");
}

// CONFIRM A PAYMENT THE BROWSER DROPPED.
//
// Money with Razorpay, order stuck at "created", student not enrolled — the
// office types the Razorpay payment id from the Razorpay dashboard and presses
// confirm. NOTHING is taken on trust: the id must match a CAPTURED payment on
// this very order at Razorpay, or nothing happens. On success the same code
// path as a normal checkout finishes the job — enrolment, invoice (allocated
// the NEXT serial in the running series, never reused, never backdated) and
// the emails.
export async function adminConfirmPayment(formData: FormData): Promise<void> {
  if (!(await requireArea("store"))) return;
  const id = str(formData.get("id"));
  const table = str(formData.get("table")) === "gift_orders" ? "gift_orders" as const : "orders" as const;
  const paymentId = str(formData.get("payment_id")).trim();
  if (!id) return;
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
    redirect(`/admin/orders?confirmerr=${encodeURIComponent("Enter the Razorpay payment id — it looks like pay_XXXXXXXXXXXX, on the payment in the Razorpay dashboard.")}`);
  }
  const { reconcileStuckPayment } = await import("@/lib/paymentReconcile");
  const r = await reconcileStuckPayment(table, id, { paymentId });
  revalidatePath("/admin/orders");
  redirect(`/admin/orders?${r.ok ? `confirmed=${encodeURIComponent(r.did ?? "done")}` : `confirmerr=${encodeURIComponent(r.reason ?? "could not confirm")}`}`);
}

// Reissue a BOOK order's invoice under the same number — used when one went out
// without the address, which every book order has in ship_to.
export async function reissueBookInvoice(formData: FormData): Promise<void> {
  if (!(await requireArea("store"))) return;
  const id = str(formData.get("id"));
  if (!id) return;
  const { reissueBookOrderInvoice } = await import("@/lib/orderInvoice");
  const r = await reissueBookOrderInvoice(id, true);
  revalidatePath("/admin/orders");
  redirect(`/admin/orders?${r.ok ? `confirmed=${encodeURIComponent(`invoice ${r.invoiceNo} reissued with the address`)}` : `confirmerr=${encodeURIComponent(r.reason ?? "could not reissue")}`}`);
}
