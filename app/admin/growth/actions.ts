"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { assertArea } from "@/lib/adminAccess";
import { draftGrowthIdeas } from "@/lib/ai";

// The growth desk drafts and remembers. It never posts, never messages —
// the founder said he makes the content himself; this page only hands him
// ideas and keeps the checklist honest.

const IDEAS_KEY = "growth_ideas";
const CHECK_KEY = "growth_checklist";

export async function refreshIdeas(): Promise<void> {
  await assertArea(null);
  const ideas = await draftGrowthIdeas();
  if (!ideas || !ideas.length) redirect("/admin/growth?err=1");
  await createServiceClient().from("site_settings").upsert(
    { key: IDEAS_KEY, value: JSON.stringify({ at: new Date().toISOString(), ideas }) },
    { onConflict: "key" },
  );
  revalidatePath("/admin/growth");
  redirect("/admin/growth");
}

export async function toggleCheck(formData: FormData): Promise<void> {
  await assertArea(null);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const svc = createServiceClient();
  const { data } = await svc.from("site_settings").select("value").eq("key", CHECK_KEY).maybeSingle();
  let map: Record<string, string> = {};
  try { map = JSON.parse(String(data?.value ?? "{}")); } catch { /* start fresh */ }
  if (map[id]) delete map[id];
  else map[id] = new Date().toISOString();
  await svc.from("site_settings").upsert({ key: CHECK_KEY, value: JSON.stringify(map) }, { onConflict: "key" });
  revalidatePath("/admin/growth");
}
