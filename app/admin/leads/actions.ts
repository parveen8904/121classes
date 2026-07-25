"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";
import { toPhone } from "@/lib/leadParse";

async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// Bulk import lives in /api/admin/leads-import (batched from the browser) so
// huge files aren't limited by the 1 MB Server Action body cap, and duplicates
// are rejected by the leads table's unique indexes.

export async function deleteLead(formData: FormData) {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("leads").delete().eq("id", id);
  revalidatePath("/admin/leads");
}

// Add one lead by hand (e.g. a number collected on a call).
export async function addLeadManual(formData: FormData) {
  if (!(await requireAdmin())) return;
  const phone = toPhone(str(formData.get("phone")));
  const email = str(formData.get("email")).trim().toLowerCase() || null;
  if (!phone && !email) redirect("/admin/leads?msg=nocontact");
  const svc = createServiceClient();
  // Same dedupe + student-match as the bulk import.
  const [{ data: dupe }, { data: prof }] = await Promise.all([
    phone
      ? svc.from("leads").select("id").eq("phone", phone).limit(1).maybeSingle()
      : svc.from("leads").select("id").eq("email", email).limit(1).maybeSingle(),
    phone
      ? svc.from("profiles").select("id").like("phone", `%${phone}`).limit(1).maybeSingle()
      : svc.from("profiles").select("id").eq("email", email).limit(1).maybeSingle(),
  ]);
  if (dupe) redirect("/admin/leads?msg=exists");
  await svc.from("leads").insert({
    name: str(formData.get("name")) || null,
    phone,
    email,
    note: str(formData.get("note")) || null,
    source: "manual",
    matched_user_id: prof?.id ?? null,
  });
  revalidatePath("/admin/leads");
  redirect("/admin/leads?msg=added1");
}
