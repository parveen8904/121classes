"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str, num, money } from "../_lib/util";
import { assertArea } from "@/lib/adminAccess";

export async function updatePlan(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  const name = str(formData.get("name"));
  if (!id || !name) return;
  const supabase = createClient();
  await supabase
    .from("plans")
    .update({
      name,
      web_price_inr: num(formData.get("web_price_inr"), 0),
      app_price_inr: num(formData.get("app_price_inr"), 0),
      is_active: formData.get("is_active") === "on",
    })
    .eq("id", id);
  revalidatePath("/admin/plans");
}

// Gold validity options shown to students (comma-separated months).
export async function setGoldValidityOptions(formData: FormData) {
  await assertArea(null);
  const raw = str(formData.get("gold_validity_options"));
  const cleaned = raw
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 60)
    .join(",");
  const supabase = createClient();
  await supabase
    .from("site_settings")
    .upsert({ key: "gold_validity_options", value: cleaned || "1,3,6,12" }, { onConflict: "key" });
  revalidatePath("/admin/plans");
}

/**
 * Set a subject's PRICE from the pricing page.
 *
 * He asked for this when the ladder was built and again today: pricing belongs
 * on the pricing page, not buried inside Content & courses. This page used to
 * say "set it on each subject's page" and send him away.
 *
 * It writes the price columns ONLY. A save here must never touch a subject's
 * title, code or applicability — a form that rewrites fields it does not show
 * is how filled fields go blank.
 */
export async function saveSubjectPricing(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;

  // "1:1000, 2:900" — months up to, and the rate for the months up to it.
  const ladder = (raw: string) => {
    const slabs = raw
      .split(/[,\n]/)
      .map((p) => {
        const [u, r] = p.split(":");
        return [parseInt((u ?? "").trim(), 10), parseFloat((r ?? "").trim().replace(/[₹,\s]/g, ""))] as const;
      })
      .filter(([upto, rate]) => Number.isFinite(upto) && upto > 0 && Number.isFinite(rate) && rate >= 0)
      .map(([upto, rate]) => ({ upto, rate: Math.round(rate * 100) / 100 }))
      .sort((a, b) => a.upto - b.upto);
    return slabs.length ? slabs : null;
  };

  await createServiceClient()
    .from("subjects")
    .update({
      gold_slabs: ladder(str(formData.get("gold_slabs"))),
      silver_slabs: ladder(str(formData.get("silver_slabs"))),
      gold_price_inr: money(formData.get("gold_price_inr")),
      batch_months: num(formData.get("batch_months")) || null,
      batch_price_inr: money(formData.get("batch_price_inr")),
      sale_from: str(formData.get("sale_from")) || null,
      sale_to: str(formData.get("sale_to")) || null,
    })
    .eq("id", id);

  revalidatePath("/admin/plans");
  revalidatePath("/", "layout");
}
