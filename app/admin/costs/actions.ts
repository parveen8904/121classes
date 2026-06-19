"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

async function isAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

export async function saveCostSettings(formData: FormData) {
  if (!(await isAdmin())) return;
  const rows = [
    { key: "bunny_cap_usd", value: String(Number(formData.get("bunny_cap_usd")) || 0) },
    { key: "supabase_storage_cap_mb", value: String(Number(formData.get("supabase_storage_cap_mb")) || 0) },
    { key: "cost_alert_email", value: String(formData.get("cost_alert_email") || "").trim() },
  ];
  await createServiceClient().from("site_settings").upsert(rows, { onConflict: "key" });
  revalidatePath("/admin/costs");
}
