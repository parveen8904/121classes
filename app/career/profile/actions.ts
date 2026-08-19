"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Save the student's placement profile. The uploads happen in the browser
// (straight to the private bucket, like answer books); this stores the fields
// and the file references.
export async function saveCareerProfile(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/career/profile");

  const s = (k: string, max = 2000) => String(formData.get(k) ?? "").trim().slice(0, max);

  const svc = createServiceClient();
  await svc.from("career_profiles").upsert({
    student_id: user.id,
    full_name: s("full_name", 120),
    email: s("email", 200) || user.email || "",
    phone: s("phone", 20),
    city: s("city", 80),
    state: s("state", 80),
    qualification: s("qualification"),
    education: s("education"),
    articleship: s("articleship"),
    experience: s("experience"),
    skills: s("skills"),
    preferred_locations: s("preferred_locations", 300),
    about: s("about"),
    // File refs come from the browser upload; keep the old one when nothing new.
    ...(s("resume_url", 300) ? { resume_url: s("resume_url", 300) } : {}),
    ...(s("photo_url", 300) ? { photo_url: s("photo_url", 300) } : {}),
    share_consent: formData.get("share_consent") === "on",
    updated_at: new Date().toISOString(),
  }, { onConflict: "student_id" });

  revalidatePath("/career/profile");
  redirect("/career/profile?saved=1");
}
