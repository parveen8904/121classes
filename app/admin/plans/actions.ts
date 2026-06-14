"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, num } from "../_lib/util";

export async function updatePlan(formData: FormData) {
  const id = str(formData.get("id"));
  const name = str(formData.get("name"));
  if (!id || !name) return;
  const supabase = createClient();
  await supabase
    .from("plans")
    .update({
      name,
      web_price_inr: num(formData.get("web_price_inr"), 0),
      app_price_inr: num(formData.get("app_price_inr"), 0),
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  revalidatePath("/admin/plans");
}

// Gold validity options shown to students (comma-separated months).
export async function setGoldValidityOptions(formData: FormData) {
  const raw = str(formData.get("gold_validity_options"));
  const cleaned = raw
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 60)
    .join(",");
  const supabase = createClient();
  await supabase
    .from("site_settings")
    .upsert({ key: "gold_validity_options", value: cleaned || "1,3,6,12" }, { onConflict: "key" });
  revalidatePath("/admin/plans");
}
