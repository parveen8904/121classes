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

// Which YouTube videos the HOMEPAGE shows — hand-picked by the admin (max 8).
// Stored as JSON [{id,title}] in site_settings; empty = latest 3 automatically.
export async function saveHomepageVideos(formData: FormData) {
  if (!(await requireAdmin())) return;
  const picks = formData.getAll("vid").map(String).slice(0, 8);
  const videos = picks
    .map((v) => {
      const i = v.indexOf(":::");
      return i > 0 ? { id: v.slice(0, i), title: v.slice(i + 3).slice(0, 140) } : null;
    })
    .filter((v): v is { id: string; title: string } => !!v && /^[\w-]{6,}$/.test(v.id));
  const svc = createServiceClient();
  await svc.from("site_settings").upsert([
    { key: "homepage_yt_videos", value: JSON.stringify(videos) },
    // Changing the picks should also fetch their thumbnails afresh.
    { key: "homepage_yt_v", value: String(Date.now()) },
  ], { onConflict: "key" });
  revalidatePath("/admin/marketing");
  // "layout" purges the whole route tree for "/", not just its data — a plain
  // revalidatePath("/") was leaving the homepage rendering an older selection,
  // which read as "it is showing the latest videos instead of mine".
  revalidatePath("/", "layout");
}

// Force new thumbnails.
//
// A YouTube thumbnail lives at a fixed address —
// i.ytimg.com/vi/<id>/mqdefault.jpg — so replacing the picture on YouTube does
// not change the URL. Browsers, and every cache between us and them, keep
// serving the copy they already hold, which is why a new thumbnail never
// appeared however often the page was reloaded. This stamps a new version
// marker onto those URLs, which every cache treats as a different image.
export async function refreshHomepageThumbnails() {
  if (!(await requireAdmin())) return;
  await createServiceClient().from("site_settings").upsert(
    { key: "homepage_yt_v", value: String(Date.now()) },
    { onConflict: "key" },
  );
  revalidatePath("/admin/marketing");
  revalidatePath("/", "layout");
}

// The big video at the top of the homepage. Left blank it plays the channel's
// newest upload — which is right until a class recording or a stray clip
// happens to be newest, and the front page changes on its own. Picking one
// here pins it.
export async function saveHomepageIntroVideo(formData: FormData) {
  if (!(await requireAdmin())) return;
  const picked = String(formData.get("intro_vid") ?? "").trim();
  const url =
    picked === "" || picked === "latest"
      ? "" // blank = follow the channel's newest video, as before
      : /^[\w-]{6,}$/.test(picked)
        ? `https://www.youtube.com/watch?v=${picked}`
        : picked; // a pasted link (YouTube or anything embeddable)
  const svc = createServiceClient();
  await svc.from("site_settings").upsert({ key: "intro_video_url", value: url }, { onConflict: "key" });
  revalidatePath("/admin/marketing");
  revalidatePath("/", "layout");
}
