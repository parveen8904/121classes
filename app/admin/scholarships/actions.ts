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

// Approve → issue a single-use coupon locked to the student's email (15% merit /
// 10% need), valid 90 days, and email it to them. Reject → just mark rejected.
export async function decideScholarship(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  const decision = str(formData.get("decision")); // approve | reject
  if (!id) return;
  const svc = createServiceClient();
  const { data: app } = await svc.from("scholarship_applications").select("id, kind, student_id, status").eq("id", id).maybeSingle();
  if (!app || app.status !== "pending") return;

  if (decision === "reject") {
    await svc.from("scholarship_applications").update({ status: "rejected", admin_note: str(formData.get("admin_note")) || null }).eq("id", id);
    revalidatePath("/admin/scholarships");
    return;
  }

  const pct = app.kind === "merit" ? 15 : 10;
  const { data: prof } = await svc.from("profiles").select("email, full_name").eq("id", app.student_id).maybeSingle();
  const email = (prof?.email ?? "").trim().toLowerCase();
  const code = `SCH${pct}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const expires = new Date(); expires.setDate(expires.getDate() + 90);
  await svc.from("coupons").insert({
    code, percent_off: pct, scope: "user", for_email: email || null, max_uses: 1, expires_at: expires.toISOString(), is_active: true,
  });
  await svc.from("scholarship_applications").update({
    status: "approved", discount_percent: pct, coupon_code: code, admin_note: str(formData.get("admin_note")) || null,
  }).eq("id", id);

  if (email) {
    try {
      const { sendTemplate } = await import("@/lib/emailTemplates");
      await sendTemplate("scholarship_approved", email, {
        heading: "Good news! 💚",
        name: prof?.full_name || "there",
        percent: pct,
        code,
        action_url: "https://caparveensharma.com/courses",
        action_label: "Enrol now →",
      });
    } catch { /* coupon still issued */ }
  }
  revalidatePath("/admin/scholarships");
}
