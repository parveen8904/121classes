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

// ── Testimonials ───────────────────────────────────────────────────────────
// The homepage quotes real students now, entered here with the registration
// number that makes a quote checkable. Placeholders are gone for good.
export async function addTestimonial(formData: FormData) {
  await assertArea(null);
  const quote = str(formData.get("quote"));
  const student_name = str(formData.get("student_name"));
  const reg_no = str(formData.get("reg_no")) || null;
  if (!quote || !student_name) return;
  const { createServiceClient } = await import("@/lib/supabase/service");
  await createServiceClient().from("testimonials").insert({
    quote, student_name, reg_no,
    sort: Number(formData.get("sort")) || 0,
  });
  revalidatePath("/admin/site");
  revalidatePath("/");
}

export async function deleteTestimonial(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  const { createServiceClient } = await import("@/lib/supabase/service");
  await createServiceClient().from("testimonials").delete().eq("id", id);
  revalidatePath("/admin/site");
  revalidatePath("/");
}
