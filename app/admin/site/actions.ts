"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str } from "../_lib/util";
import { assertArea } from "@/lib/adminAccess";

const KEYS = [
  "logo_url",
  "founder_photo",
  "hero_banner",
  "studio_photo",
  "splash_banner",
  "splash_link",
  "splash_seconds",
  "intro_video_url",
  "support_whatsapp",
  "whatsapp_faculty",
  "support_phone",
  "support_telegram",
  "app_url_web",
  "app_url_mac",
  "app_url_windows",
  "app_url_ios",
  "app_url_android",
  // Google Search Console's token — rendered as a meta tag on the homepage,
  // which verifies the site without any DNS change.
  "google_site_verification",
];

export async function updateSiteSettings(formData: FormData) {
  await assertArea(null);
  const supabase = createClient();
  const rows = KEYS.map((k) => ({ key: k, value: str(formData.get(k)) || null }));
  await supabase.from("site_settings").upsert(rows, { onConflict: "key" });
  revalidatePath("/admin/site");
  revalidatePath("/");
}
