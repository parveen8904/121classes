"use server";

import { requireArea } from "@/lib/adminAccess";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";

async function requireAdmin(): Promise<boolean> {
  return requireArea("career"); // admin always; operator/faculty with this right
}

// Career Corner content only. Wellness is now hardcoded (lib/motivation.ts),
// amendments live in /admin/amendments, and planner cadence in /admin/planner —
// each on its own page, so nothing is mixed here anymore.
export async function saveContent(formData: FormData) {
  if (!(await requireAdmin())) return;
  const svc = createServiceClient();
  const rows = [
    { key: "career_articleship", value: str(formData.get("career_articleship")) },
    { key: "career_placement", value: str(formData.get("career_placement")) },
    { key: "career_resources", value: str(formData.get("career_resources")) },
    { key: "career_jobs", value: str(formData.get("career_jobs")) },
    { key: "career_links", value: str(formData.get("career_links")) },
    { key: "career_cities", value: str(formData.get("career_cities")) },
  ];
  for (const r of rows) await svc.from("site_settings").upsert(r, { onConflict: "key" });
  redirect("/admin/content?saved=1");
}
