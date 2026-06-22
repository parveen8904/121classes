"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AI_TOGGLES } from "@/lib/ai";

// Save which AI services are switched ON. Anything not ticked is stored in the
// disabled list, so that feature stops making AI calls (cost control).
export async function saveAiFeatures(formData: FormData) {
  const disabled = AI_TOGGLES.filter((t) => formData.get(`ai_on_${t.key}`) !== "on").map((t) => t.key);
  const supabase = createClient();
  await supabase
    .from("site_settings")
    .upsert({ key: "ai_disabled_features", value: JSON.stringify(disabled) }, { onConflict: "key" });
  revalidatePath("/admin/ai-usage");
}

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
