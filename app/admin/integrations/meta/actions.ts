"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../../_lib/util";

// One-tap wiring: save the chosen Instagram business-account id so campaigns
// auto-post to it.
export async function useMetaAccount(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return;

  const igId = str(formData.get("ig_id"));
  if (!igId) return;
  await createServiceClient().from("app_secrets").upsert({ key: "INSTAGRAM_USER_ID", value: igId }, { onConflict: "key" });
  redirect("/admin/integrations/meta?saved=1");
}
