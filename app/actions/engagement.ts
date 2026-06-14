"use server";

import { createClient } from "@/lib/supabase/server";

// "Notify me" for a live class/event. Works logged-in (uses account email) or
// logged-out (the visitor types an email).
export async function subscribeReminder(formData: FormData): Promise<{ ok: boolean }> {
  const sessionId = (formData.get("session_id") as string) || null;
  const typed = ((formData.get("email") as string) || "").trim() || null;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = typed ?? user?.email ?? null;
  if (!email && !user) return { ok: false };
  await supabase.from("class_reminders").insert({
    session_id: sessionId,
    user_id: user?.id ?? null,
    email,
  });
  return { ok: true };
}

// Site-wide "Ask me" inbox. Captures the question + which page it came from.
export async function askQuestion(formData: FormData): Promise<{ ok: boolean }> {
  const question = ((formData.get("question") as string) || "").trim();
  const pagePath = (formData.get("page_path") as string) || null;
  const typed = ((formData.get("email") as string) || "").trim() || null;
  if (!question) return { ok: false };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("page_questions").insert({
    user_id: user?.id ?? null,
    email: typed ?? user?.email ?? null,
    page_path: pagePath,
    question,
  });
  return { ok: true };
}
