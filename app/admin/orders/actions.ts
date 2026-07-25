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
