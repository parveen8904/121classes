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

// Manually email the warehouse the current paid-but-unshipped orders.
export async function sendDispatchEmail() {
  if (!(await requireArea("store"))) return;
  const r = await runWarehouseDispatch();
  revalidatePath("/admin/orders");
  redirect(`/admin/orders?dispatch=${r.skipped ? "skipped" : r.count}`);
}
