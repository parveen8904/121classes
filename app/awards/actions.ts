"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../admin/_lib/util";

export async function submitAward(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/awards");
  const name = str(formData.get("name")).trim();
  const phone = str(formData.get("phone")).trim();
  const achievement = str(formData.get("achievement")).trim();
  if (!name || !phone || !achievement || formData.get("studied") !== "on") {
    redirect("/awards?err=1");
  }
  await createServiceClient().from("award_submissions").insert({
    student_id: user.id,
    name, phone, email: user.email ?? null,
    achievement,
    marks: str(formData.get("marks")) || null,
    photo_url: str(formData.get("photo_url")) || null,
    marksheet_url: str(formData.get("marksheet_url")) || null,
    studied_with_us: true,
    message: str(formData.get("message")) || null,
  });
  redirect("/awards?done=1");
}
