"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, num } from "../_lib/util";

export async function createCoupon(formData: FormData) {
  const code = str(formData.get("code")).toUpperCase().replace(/\s+/g, "");
  if (!code) return;
  const percent = num(formData.get("percent_off"), 0);
  const amount = num(formData.get("amount_off_inr"), 0);
  const maxUses = num(formData.get("max_uses"), 0);
  const scope = ["any", "user", "donor"].includes(str(formData.get("scope"))) ? str(formData.get("scope")) : "any";
  const expiry = str(formData.get("expires_at")); // yyyy-mm-dd or blank
  const forEmail = str(formData.get("for_email")).trim().toLowerCase() || null;
  const supabase = createClient();
  await supabase.from("coupons").insert({
    code,
    percent_off: percent > 0 ? Math.min(100, percent) : null,
    amount_off_inr: amount > 0 ? amount : null,
    max_uses: maxUses > 0 ? maxUses : null,
    scope,
    for_email: forEmail,
    expires_at: expiry ? new Date(expiry + "T23:59:59").toISOString() : null,
    is_active: formData.get("is_active") === "on",
  });
  revalidatePath("/admin/coupons");
}

export async function deleteCoupon(formData: FormData) {
  const id = str(formData.get("id"));
  const supabase = createClient();
  await supabase.from("coupons").delete().eq("id", id);
  revalidatePath("/admin/coupons");
}

export async function toggleCoupon(formData: FormData) {
  const id = str(formData.get("id"));
  const next = formData.get("next") === "true";
  const supabase = createClient();
  await supabase.from("coupons").update({ is_active: next }).eq("id", id);
  revalidatePath("/admin/coupons");
}
