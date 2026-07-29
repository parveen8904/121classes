"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { assertArea } from "@/lib/adminAccess";
import { str, num } from "../_lib/util";

const TIERS = ["bronze", "silver", "gold"];

export async function saveAldineMapping(formData: FormData) {
  await assertArea(null);
  const productKey = str(formData.get("product_key")).replace(/\D/g, "");
  const courseId = str(formData.get("course_id"));
  if (!productKey || !courseId) redirect("/admin/aldine?err=missing");

  const tier = TIERS.includes(str(formData.get("tier"))) ? str(formData.get("tier")) : "gold";
  await createServiceClient().from("partner_products").upsert(
    {
      source: "aldine",
      product_key: productKey,
      label: str(formData.get("label")).slice(0, 120),
      course_id: courseId,
      subject_id: str(formData.get("subject_id")) || null,
      tier,
      months: Math.min(36, Math.max(1, num(formData.get("months")) || 12)),
      is_active: true,
    },
    { onConflict: "source,product_key" },
  );
  revalidatePath("/admin/aldine");
  redirect("/admin/aldine?saved=1");
}

export async function deleteAldineMapping(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (id) await createServiceClient().from("partner_products").delete().eq("id", id);
  revalidatePath("/admin/aldine");
  redirect("/admin/aldine?removed=1");
}

// An order that arrived before its product was mapped sits as "unmapped".
// After the admin adds the mapping, this replays it through the same
// provisioning path the webhook uses.
export async function retryUnmapped() {
  await assertArea(null);
  const svc = createServiceClient();
  const [{ data: rows }, { data: mappings }] = await Promise.all([
    svc.from("partner_orders").select("id, order_ref, product_key, email, name, phone").eq("source", "aldine").eq("status", "unmapped").limit(50),
    svc.from("partner_products").select("product_key, course_id, subject_id, tier, months").eq("source", "aldine").eq("is_active", true),
  ]);
  const map = new Map((mappings ?? []).map((m) => [String(m.product_key), m]));
  let granted = 0;
  const { provisionPartnerPurchase } = await import("@/lib/partnerEnroll");
  for (const o of rows ?? []) {
    const m = map.get(String(o.product_key));
    if (!m) continue;
    const r = await provisionPartnerPurchase({
      email: String(o.email), name: String(o.name ?? ""), phone: String(o.phone ?? ""),
      courseId: m.course_id as string, subjectId: (m.subject_id as string | null) ?? null,
      tier: String(m.tier), months: Number(m.months) || 12, source: "aldine",
    });
    await svc.from("partner_orders").update({
      status: r.ok ? "granted" : "error",
      detail: r.ok ? "granted on retry" : r.error,
      student_id: r.ok ? r.studentId : null,
    }).eq("id", o.id);
    if (r.ok) granted++;
  }
  revalidatePath("/admin/aldine");
  redirect(`/admin/aldine?retried=${granted}`);
}
