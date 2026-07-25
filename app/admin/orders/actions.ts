"use server";

import { requireArea } from "@/lib/adminAccess";

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
