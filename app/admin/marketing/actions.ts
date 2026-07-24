"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

async function requireAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// Which YouTube videos the HOMEPAGE shows — hand-picked by the admin (max 3).
// Stored as JSON [{id,title}] in site_settings; empty = latest 3 automatically.
export async function saveHomepageVideos(formData: FormData) {
  if (!(await requireAdmin())) return;
  const picks = formData.getAll("vid").map(String).slice(0, 3);
  const videos = picks
    .map((v) => {
      const i = v.indexOf(":::");
      return i > 0 ? { id: v.slice(0, i), title: v.slice(i + 3).slice(0, 140) } : null;
    })
    .filter((v): v is { id: string; title: string } => !!v && /^[\w-]{6,}$/.test(v.id));
  const svc = createServiceClient();
  await svc.from("site_settings").upsert(
    { key: "homepage_yt_videos", value: JSON.stringify(videos) },
    { onConflict: "key" },
  );
  revalidatePath("/admin/marketing");
  revalidatePath("/");
}
