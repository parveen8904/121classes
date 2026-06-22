"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegramChannel } from "@/lib/notify";
import { postToAllGroups, postToSubjectGroup } from "@/lib/telegramBroadcast";
import { str } from "../_lib/util";

async function isAdmin(): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// Toggle: only answer doubts from connected (linked) students.
export async function saveTelegramSettings(formData: FormData) {
  if (!(await isAdmin())) return;
  const svc = createServiceClient();
  await svc.from("site_settings").upsert(
    { key: "telegram_connected_only", value: formData.get("connected_only") === "on" ? "1" : "" },
    { onConflict: "key" },
  );
  const { clearSecretCache } = await import("@/lib/secrets");
  clearSecretCache();
  revalidatePath("/admin/telegram");
}

// Link a captured Telegram group to a subject (one chat = one subject).
export async function linkGroupToSubject(formData: FormData) {
  if (!(await isAdmin())) return;
  const chatId = str(formData.get("chat_id"));
  const subjectId = str(formData.get("subject_id"));
  if (!chatId) return;
  const svc = createServiceClient();
  // Clear this chat from any other subject first, then set it on the chosen one.
  await svc.from("subjects").update({ telegram_group_chat_id: null }).eq("telegram_group_chat_id", chatId);
  if (subjectId) await svc.from("subjects").update({ telegram_group_chat_id: chatId }).eq("id", subjectId);
  revalidatePath("/admin/telegram");
}

// Manual send to the channel, one subject's group, or all groups.
export async function sendTelegramManual(formData: FormData) {
  if (!(await isAdmin())) return;
  const text = str(formData.get("text"));
  const link = str(formData.get("link")) || undefined;
  const target = str(formData.get("target"));
  if (!text || !target) return;
  if (target === "channel") await sendTelegramChannel(text, link);
  else if (target === "all") await postToAllGroups(text, link);
  else await postToSubjectGroup(target, text, link); // target = subjectId
  redirect("/admin/telegram?sent=1");
}
