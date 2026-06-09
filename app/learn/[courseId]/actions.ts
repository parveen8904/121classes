"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str } from "../../admin/_lib/util";

// Student toggles auto-renew on their OWN subscription (via the
// ownership-checked SECURITY DEFINER RPC). Cancelling = auto_renew off;
// access still runs to the end of the paid period.
export async function setAutoRenew(formData: FormData) {
  const subId = str(formData.get("sub_id"));
  const courseId = str(formData.get("course_id"));
  const on = formData.get("on") === "true";
  if (!subId) return;
  const supabase = createClient();
  await supabase.rpc("set_my_auto_renew", { p_sub: subId, p_on: on });
  if (courseId) revalidatePath(`/learn/${courseId}`);
}
