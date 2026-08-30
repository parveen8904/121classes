import { createServiceClient } from "@/lib/supabase/service";
import { answerDoubtFromMaterial, answerDoubtWithAttachment, aiFeatureEnabled, judgeStudentMessage, ABUSE_WARNING, NEED_FACULTY } from "@/lib/ai";
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

/**
 * A MESSAGE THAT IS ONLY AN ACKNOWLEDGEMENT — SAY NOTHING.
 *
 * His instruction, 26 Aug 2026: "do not reply to thank you, okay, et cetera,
 * oh ho, or similar exclamations."
 *
 * The AI judge already classified small talk as chatter, but it is a model
 * call: it costs money, it takes a second, and on a tagged "thanks sir 🙏" it
 * sometimes decided there was a question in there and answered it. A thank-you
 * needs no model to recognise, so it is settled here in code, before anything
 * is spent, and the answer is silence.
 *
 * Deliberately narrow. It fires only when the WHOLE message is an
 * acknowledgement -- "ok" alone is silence, but "ok but why is goodwill not
 * amortised" is a question and must reach the AI. Anything with a question
 * mark is never treated as an acknowledgement.
 */
/** Every word that can appear in a message that says nothing. */
const ACK_WORDS = new Set([
  // English thanks
  "thanks", "thank", "thankyou", "thanx", "thanku", "thnx", "thnks", "thnk", "thx", "tnx", "ty", "tysm",
  "welcome", "lot", "a", "ton", "loads",
  // Assent
  "ok", "okay", "okk", "okkk", "k", "kk", "kkk", "fine", "good", "great", "nice", "cool",
  "super", "perfect", "excellent", "awesome", "brilliant", "lovely",
  "got", "gotit", "understood", "noted", "sure", "right", "correct", "true",
  "yes", "yeah", "yep", "yup", "no", "nope", "done", "clear", "cleared", "helpful", "help",
  // Exclamations -- "oh ho" is two words and both must be here
  "oh", "ohh", "ohhh", "oho", "ohho", "ho", "hoo", "ah", "ahh", "aha", "haha", "hehe",
  "hmm", "hm", "hmmm", "hmmmm", "wow", "oops", "arre", "arey", "are",
  // Hindi / Hinglish
  "acha", "achha", "accha", "acchha", "achcha",
  "dhanyavad", "dhanyawad", "shukriya", "theek", "thik", "thike", "sahi", "bilkul",
  "haan", "han", "haa", "haaa", "ha", "hn", "hanji", "samajh", "samjha", "samjh", "samajhgaya",
  "gaya", "gyi", "gya", "hai", "he", "h", "now", "ab",
  "pranam", "namaste", "namaskar", "congrats", "congratulations", "welldone", "bravo",
]);

export function isAcknowledgement(text: string): boolean {
  let t = String(text ?? "")
    .replace(/@[a-z0-9_]+/gi, " ")            // the bot tag itself is not content
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")  // emoji
    .toLowerCase()
    .replace(/[.!,\-~*_'"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return true;                         // a bare tag or a lone emoji
  if (t.includes("?")) return false;           // a question is never a thank-you
  if (t.length > 40) return false;             // long enough to be saying something

  // Politeness and filler that may surround the acknowledgement itself.
  t = t.replace(/\b(sir|sirji|ji|maam|madam|bhai|yaar|so|very|much|too|the|u|you|all|guys|everyone|it|that|this|na|hi|hello|for|your|reply|answer|s|its)\b/g, " ")
       .replace(/\s+/g, " ").trim();
  if (!t) return true;

  // EVERY remaining word must itself be an acknowledgement. That is what keeps
  // "thanks" silent while "thanks what about AS 10" still reaches the AI: one
  // word that is not on this list and the whole message is treated as real.
  return t.split(" ").every((w) => ACK_WORDS.has(w));
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
  /**
   * A PHOTOGRAPHED QUESTION. Students photograph the page and type three
   * words — "Treatment of 3rd point" — because the question is in the picture,
   * not in the caption. Answering from the caption alone is answering a
   * question nobody asked.
   */
  attachment?: { dataB64: string; mediaType: string } | null,
): Promise<string | null> {
  // A photo IS the question, so the guards that protect against replying to
  // a shrug must not fire on it. Three words under a picture of a scheme of
  // reconstruction is not chit-chat, and a bare photo with no caption at all
  // is still a question.
  if (!attachment) {
    if (question.trim().length < 5) return null;
    // Cheapest test first: a thank-you costs nothing to recognise and is
    // answered with silence, per his instruction.
    if (isAcknowledgement(question)) return null;
  }
  if (!(await aiFeatureEnabled("group_doubt"))) return null;
  if (!(await budgetLeft())) return null;

  // Answer real questions; say nothing to chit-chat; warn once on abuse.
  // Replying earnestly to "Hi" and "classes" made the bot look silly and cost
  // money on every shrug. Abuse is still abuse when it arrives under a photo,
  // so that test runs either way — only the chatter verdict is set aside.
  const judged = await judgeStudentMessage(question || "(a photographed question)");
  if (judged.kind === "abusive") return ABUSE_WARNING;
  if (!attachment && judged.kind === "chatter") return null;
  // The caption alone is a poor search key for a photographed question, so the
  // subject's whole context is fetched on the topic words that are there.
  const material = await getRepositoryContext(subjectId, 12000, { query: question });
  const raw = attachment
    ? await answerDoubtWithAttachment(question, material, attachment)
    : await answerDoubtFromMaterial(question, material, "group_doubt");
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
  // NO DISCLAIMER TO THE STUDENT. His instruction: "there is no need to put any
  // disclaimer" — a student wants the answer, not a note about where it came
  // from. So the ungrounded case simply does not claim him. His name is earned
  // by his material being there, and withheld quietly when it is not.
  return grounded
    ? "— AI assistant, answering from CA Parveen Sharma's own class material"
    : "— AI assistant";
}
