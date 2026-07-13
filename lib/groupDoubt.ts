import { createServiceClient } from "@/lib/supabase/service";
import { answerDoubtFromMaterial, aiFeatureEnabled, NEED_FACULTY } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";

// Shared brain for AI answers in the STUDY GROUPS (Telegram webhook + the
// Discord worker's /api/group-ai-answer endpoint), so both platforms behave
// identically: same question detection, same toggle, same daily cap.

// Does a group message look like an academic QUESTION worth an AI answer?
// Deliberately conservative — greetings/chit-chat must never trigger the AI.
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 15) return false;
  if (t.includes("?")) return true;
  return /\b(how|what|why|when|where|which|whether|explain|solve|difference|doubt|calculate|clarify|anyone|help|confus|kya|kaise|kyun|kyu|kab|samjha)\b/i.test(t);
}

// Daily cap on group AI answers (all groups combined) so a chatty day can't run
// up the bill. Configurable via site_settings key ai_group_doubt_daily_limit.
async function budgetLeft(): Promise<boolean> {
  const svc = createServiceClient();
  const { data } = await svc.from("site_settings").select("value").eq("key", "ai_group_doubt_daily_limit").maybeSingle();
  const cap = Number(data?.value) || 100;
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { count } = await svc
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("feature", "group_doubt")
    .gte("created_at", dayStart.toISOString());
  return (count ?? 0) < cap;
}

// Full pipeline: toggle → cap → subject material → answer. Returns the ready-to-
// post message body (marked 🤖), or null when the AI should stay SILENT.
export async function groupAiAnswer(subjectId: string, question: string): Promise<string | null> {
  if (!looksLikeQuestion(question)) return null;
  if (!(await aiFeatureEnabled("group_doubt"))) return null;
  if (!(await budgetLeft())) return null;
  const material = await getRepositoryContext(subjectId, 12000, { query: question });
  const raw = await answerDoubtFromMaterial(question, material, "group_doubt");
  const answer = raw && raw.trim() !== NEED_FACULTY ? raw.trim() : null;
  if (!answer) return null;
  return `🤖 ${answer}\n\n— AI assistant, under CA Parveen Sharma's guidance`;
}
