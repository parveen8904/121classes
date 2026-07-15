"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";

async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

export async function saveGstSettings(formData: FormData) {
  if (!(await requireAdmin())) return;
  const svc = createServiceClient();
  const set = async (key: string, value: string) => svc.from("site_settings").upsert({ key, value }, { onConflict: "key" });
  await Promise.all([
    set("gst_enabled", formData.get("gst_enabled") === "on" ? "1" : "0"),
    set("gst_number", str(formData.get("gst_number")).trim()),
    set("gst_legal_name", str(formData.get("gst_legal_name"))),
    set("gst_address", str(formData.get("gst_address"))),
    set("gst_state", str(formData.get("gst_state")).trim() || "Delhi"),
    set("gst_rate", String(Number(str(formData.get("gst_rate"))) || 18)),
    set("gst_sac", str(formData.get("gst_sac")).trim() || "999293"),
    set("gst_inclusive", formData.get("gst_inclusive") === "on" ? "1" : "0"),
    set("invoice_prefix", str(formData.get("invoice_prefix")) || "CAPS/"),
  ]);
  revalidatePath("/admin/billing");
}
