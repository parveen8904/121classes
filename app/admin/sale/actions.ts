"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str } from "../_lib/util";
import { SALE_KEYS } from "@/lib/sale";

// Save the sale configuration. Everything lives in site_settings so there's no
// schema to manage; the sale turns itself on/off purely from the dates.
export async function updateSale(formData: FormData) {
  const supabase = createClient();
  const rows = SALE_KEYS.map((k) => {
    if (k === "sale_enabled") return { key: k, value: formData.get(k) ? "1" : "" };
    if (k === "sale_discount_pct") {
      const n = Math.min(90, Math.max(0, Math.round(Number(str(formData.get(k))) || 0)));
      return { key: k, value: String(n) };
    }
    return { key: k, value: str(formData.get(k)) || null };
  });
  await supabase.from("site_settings").upsert(rows, { onConflict: "key" });
  revalidatePath("/admin/sale");
  revalidatePath("/");            // homepage banner
  revalidatePath("/", "layout");
}
