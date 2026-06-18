"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendTelegramChannel } from "@/lib/notify";

// Share an inbox item (a Q&A) to the website community board.
export async function shareToCommunity(formData: FormData) {
  const text = ((formData.get("text") as string) || "").trim();
  if (!text) return;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("community_posts").insert({ author_id: user.id, body: text });
  revalidatePath("/inbox");
  revalidatePath("/community");
}

// Share an inbox item to the Telegram channel/group (posted via the bot).
export async function shareToTelegram(formData: FormData) {
  const text = ((formData.get("text") as string) || "").trim();
  if (!text) return;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await sendTelegramChannel("💬 Shared by a student:\n\n" + text);
  revalidatePath("/inbox");
}
