"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { str, nullable } from "../../admin/_lib/util";

export async function updateProfile(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase
    .from("profiles")
    .update({
      full_name: str(formData.get("full_name")) || null,
      phone: nullable(formData.get("phone")),
      target_attempt: nullable(formData.get("target_attempt")),
      address_line1: nullable(formData.get("address_line1")),
      address_line2: nullable(formData.get("address_line2")),
      city: nullable(formData.get("city")),
      state: nullable(formData.get("state")),
      pincode: nullable(formData.get("pincode")),
      gstin: nullable(formData.get("gstin")),
      business_name: nullable(formData.get("business_name")),
    })
    .eq("id", user.id);

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard");
  // Saving closes the profile form and returns to the dashboard with a confirmation.
  redirect("/dashboard?saved=profile");
}
