"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, nullable } from "../_lib/util";

const ROLES = ["student", "admin", "faculty"];

export async function updateUser(formData: FormData) {
  const id = str(formData.get("id"));
  if (!id) return;
  const role = str(formData.get("role"));
  const supabase = createClient();
  await supabase
    .from("profiles")
    .update({
      full_name: nullable(formData.get("full_name")),
      phone: nullable(formData.get("phone")),
      target_attempt: nullable(formData.get("target_attempt")),
      role: ROLES.includes(role) ? role : "student",
      address_line1: nullable(formData.get("address_line1")),
      address_line2: nullable(formData.get("address_line2")),
      city: nullable(formData.get("city")),
      state: nullable(formData.get("state")),
      pincode: nullable(formData.get("pincode")),
      gstin: nullable(formData.get("gstin")),
      business_name: nullable(formData.get("business_name")),
    })
    .eq("id", id);
  revalidatePath(`/admin/users/${id}`);
  revalidatePath("/admin/users");
}
