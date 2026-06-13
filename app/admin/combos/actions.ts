"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, num, nullable } from "../_lib/util";

const TIERS = ["bronze", "silver", "gold"];

export async function createCombo(formData: FormData) {
  const title = str(formData.get("title"));
  if (!title) return;
  const tier = str(formData.get("tier"));
  const supabase = createClient();
  const { data: combo } = await supabase
    .from("combos")
    .insert({
      title,
      description: nullable(formData.get("description")),
      price_inr: num(formData.get("price_inr"), 0),
      tier: TIERS.includes(tier) ? tier : "gold",
      months: num(formData.get("months"), 6),
      is_active: formData.get("is_active") === "on",
    })
    .select("id")
    .single();

  const subjectIds = formData.getAll("subject_id").map((v) => String(v));
  if (combo && subjectIds.length) {
    await supabase
      .from("combo_items")
      .insert(subjectIds.map((subject_id) => ({ combo_id: combo.id, subject_id })));
  }
  revalidatePath("/admin/combos");
  revalidatePath("/combos");
}

export async function deleteCombo(formData: FormData) {
  const id = str(formData.get("id"));
  const supabase = createClient();
  await supabase.from("combos").delete().eq("id", id);
  revalidatePath("/admin/combos");
  revalidatePath("/combos");
}

export async function toggleCombo(formData: FormData) {
  const id = str(formData.get("id"));
  const next = formData.get("next") === "true";
  const supabase = createClient();
  await supabase.from("combos").update({ is_active: next }).eq("id", id);
  revalidatePath("/admin/combos");
  revalidatePath("/combos");
}
