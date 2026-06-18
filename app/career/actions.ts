"use server";

import { createClient } from "@/lib/supabase/server";
import { interviewReply, improveSummary, aiConfigured } from "@/lib/ai";

export async function mockInterview(transcript: string): Promise<{ ok: boolean; text?: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  if (!(await aiConfigured())) return { ok: false, text: "AI isn't switched on yet — please ask the admin to add the AI key." };
  const text = await interviewReply(transcript.slice(0, 8000));
  return text ? { ok: true, text } : { ok: false };
}

export async function polishSummary(text: string): Promise<{ ok: boolean; text?: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  if (!(await aiConfigured())) return { ok: false };
  const out = await improveSummary(text.slice(0, 2000));
  return out ? { ok: true, text: out } : { ok: false };
}
