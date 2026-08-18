import { createServiceClient } from "@/lib/supabase/service";
import { answerDoubtFromMaterial, aiFeatureEnabled, judgeStudentMessage, ABUSE_WARNING, NEED_FACULTY } from "@/lib/ai";
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
// NOTE: the bot answers ONLY when a student tags it (@bot …) or replies to it —
// the callers enforce that. It never jumps into a student-to-student discussion,
// so no question heuristic here: tagging the bot IS the request.
export async function groupAiAnswer(
  subjectId: string,
  question: string,
  /** Which group platform, for the record. */
  channel: "telegram_group" | "discord" = "telegram_group",
): Promise<string | null> {
  if (question.trim().length < 5) return null;
  if (!(await aiFeatureEnabled("group_doubt"))) return null;
  if (!(await budgetLeft())) return null;

  // Answer real questions; say nothing to chit-chat; warn once on abuse.
  // Replying earnestly to "Hi" and "classes" made the bot look silly and cost
  // money on every shrug.
  const judged = await judgeStudentMessage(question);
  if (judged.kind === "abusive") return ABUSE_WARNING;
  if (judged.kind === "chatter") return null;
  const material = await getRepositoryContext(subjectId, 12000, { query: question });
  const raw = await answerDoubtFromMaterial(question, material, "group_doubt");
  const answer = raw && raw.trim() !== NEED_FACULTY ? raw.trim() : null;
  if (!answer) return null;
  // A group answer is read by a whole room, so it belongs in the record he
  // reads even though nobody asked it privately.
  const { logAiExchange } = await import("@/lib/aiAnswerLog");
  await logAiExchange({ channel, question, answer });
  return `🤖 ${answer}\n\n${signOff(material)}`;
}

// DO NOT SIGN HIS NAME TO SOMETHING HE DID NOT SAY.
//
// Every group answer used to end "— AI assistant, under CA Parveen Sharma's
// guidance", whether or not a single line of his material was in front of the
// model. On 18 August a student asked in the Financial Reporting group whether
// an FCCB convertible into a fixed number of shares is a derivative. The answer
// given was the IAS 32 one: fails fixed-for-fixed, derivative liability. Ind AS
// 32 carries an India carve-out — the option is EQUITY — and the carve-out is in
// his own repository. So the room was told the IFRS position, over his name, in
// his own group, on a point examined precisely because India differs.
//
// The model's general knowledge will always be fuller than any one teacher's
// notes, and that is exactly the danger: on a carve-out, fuller is wrong. When
// there is nothing of his to lean on, the answer must say so instead of
// borrowing his authority.
//
// This is a signal, not a proof. Material being present does not guarantee the
// model used it — the sign-off says the answer was PREPARED FROM his material,
// which is what we can honestly claim, and the training lesson does the rest by
// telling the model his treatment governs where the two differ.
function signOff(material: string): string {
  // A few hundred characters is a heading and a stray line, not a teaching.
  const grounded = (material ?? "").trim().length > 800;
  return grounded
    ? "— AI assistant, answering from CA Parveen Sharma's own class material"
    : "— AI assistant. ⚠️ Nothing from Sir's material covered this, so this is general knowledge, "
      + "not his teaching. Ind AS carries India-specific carve-outs where the IFRS answer is the "
      + "wrong one, so please confirm this with Sir before you rely on it in the exam.";
}
