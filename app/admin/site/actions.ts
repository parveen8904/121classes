"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str } from "../_lib/util";

const KEYS = ["founder_photo", "hero_banner", "support_whatsapp", "support_phone"];

export async function updateSiteSettings(formData: FormData) {
  const supabase = createClient();
  const rows = KEYS.map((k) => ({ key: k, value: str(formData.get(k)) || null }));
  await supabase.from("site_settings").upsert(rows, { onConflict: "key" });
  revalidatePath("/admin/site");
  revalidatePath("/");
}
