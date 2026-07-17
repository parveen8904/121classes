"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ACCESS_CATEGORIES, PLANS, clearLimitsCache } from "@/lib/entitlements";
import { str } from "../_lib/util";

async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// Save the whole limits grid. Each cell field is "lim__<plan>__<category>" with
// a value that is a number, or "inf" for unlimited, or blank = none (0).
export async function saveAccessLimits(formData: FormData) {
  if (!(await requireAdmin())) return;
  const rows: { plan: string; category: string; lim: number }[] = [];
  for (const plan of PLANS) {
    for (const cat of ACCESS_CATEGORIES) {
      const raw = str(formData.get(`lim__${plan}__${cat.key}`)).trim().toLowerCase();
      let lim: number;
      if (raw === "" || raw === "inf" || raw === "∞" || raw === "unlimited") lim = -1;
      else if (raw === "0" || raw === "none" || raw === "x") lim = 0;
      else { const n = parseInt(raw, 10); lim = Number.isFinite(n) && n > 0 ? n : -1; }
      rows.push({ plan, category: cat.key, lim });
    }
  }
  // Per-plan fair-use watch multiplier (× total class hours). Blank = no cap (-1).
  for (const plan of PLANS) {
    const raw = str(formData.get(`watchmult__${plan}`)).trim().toLowerCase();
    let lim: number;
    if (raw === "" || raw === "inf" || raw === "∞" || raw === "unlimited") lim = -1;
    else { const n = parseInt(raw, 10); lim = Number.isFinite(n) && n > 0 ? n : -1; }
    rows.push({ plan, category: "watch_multiplier", lim });
  }

  const svc = createServiceClient();
  await svc.from("plan_limits").upsert(rows, { onConflict: "plan,category" });

  clearLimitsCache();
  revalidatePath("/admin/access");
  revalidatePath("/courses");
}
