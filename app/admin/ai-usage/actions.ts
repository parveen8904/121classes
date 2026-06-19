"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function saveAiSettings(formData: FormData) {
  const supabase = createClient();
  const rows = [
    { key: "ai_monthly_cap_usd", value: String(Number(formData.get("ai_monthly_cap_usd")) || 0) },
    { key: "ai_alert_email", value: String(formData.get("ai_alert_email") || "").trim() },
    { key: "ai_doubt_daily_limit", value: String(Number(formData.get("ai_doubt_daily_limit")) || 0) },
  ];
  await supabase.from("site_settings").upsert(rows, { onConflict: "key" });
  revalidatePath("/admin/ai-usage");
}
