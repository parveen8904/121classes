"use server";

import { redirect } from "next/navigation";
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

const ATTEMPTS = ["May 2026", "Nov 2026", "May 2027", "Nov 2027"];

// Career corner + wellness tips.
export async function saveContent(formData: FormData) {
  if (!(await requireAdmin())) return;
  const svc = createServiceClient();
  const rows = [
    { key: "career_articleship", value: str(formData.get("career_articleship")) },
    { key: "career_placement", value: str(formData.get("career_placement")) },
    { key: "career_resources", value: str(formData.get("career_resources")) },
    { key: "wellness_tips", value: str(formData.get("wellness_tips")) },
  ];
  for (const r of rows) await svc.from("site_settings").upsert(r, { onConflict: "key" });
  redirect("/admin/content?saved=1");
}

// Amendments info per attempt (cut-off date, applicable, expected-if-you-change).
export async function saveAmendments(formData: FormData) {
  if (!(await requireAdmin())) return;
  const svc = createServiceClient();
  for (const a of ATTEMPTS) {
    const value = JSON.stringify({
      cutoff: str(formData.get(`cutoff:${a}`)),
      applicable: str(formData.get(`applicable:${a}`)),
      expected: str(formData.get(`expected:${a}`)),
    });
    await svc.from("site_settings").upsert({ key: `amend:${a}`, value }, { onConflict: "key" });
  }
  redirect("/admin/content?saved=1");
}
