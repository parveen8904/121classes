"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str } from "../_lib/util";

export async function setOrderStatus(formData: FormData) {
  const id = str(formData.get("id"));
  const status = str(formData.get("status"));
  if (!id || !["paid", "dispatched", "delivered", "cancelled"].includes(status)) return;
  const supabase = createClient();
  await supabase.from("book_orders").update({ status }).eq("id", id);
  revalidatePath("/admin/orders");
}
