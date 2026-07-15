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

export async function setAwardStatus(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  const status = str(formData.get("status")); // approved | rejected
  if (!id || !["approved", "rejected"].includes(status)) return;
  await createServiceClient().from("award_submissions").update({ status, admin_note: str(formData.get("admin_note")) || null }).eq("id", id);
  revalidatePath("/admin/awards");
}

export async function deleteAward(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  if (id) await createServiceClient().from("award_submissions").delete().eq("id", id);
  revalidatePath("/admin/awards");
}
