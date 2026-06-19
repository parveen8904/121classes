// Claude (Anthropic) integration — SERVER-ONLY. Degrades gracefully: when
// ANTHROPIC_API_KEY is absent, AI calls return null and the app falls back to
// "our faculty will review this".

import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";

export async function aiConfigured(): Promise<boolean> {
  return Boolean(await getSecret("ANTHROPIC_API_KEY"));
}

// Cheaper model for high-frequency student calls (doubts / ask-me). Override
// via the ANTHROPIC_MODEL_FAST secret. Defaults to Haiku (~3x cheaper).
async function fastModel(): Promise<string> {
  return (await getSecret("ANTHROPIC_MODEL_FAST")) || "claude-haiku-4-5";
}

// Per-1M-token prices (USD) by model family, for the admin cost readout.
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus": { in: 5, out: 25 },
  "claude-sonnet": { in: 3, out: 15 },
  "claude-haiku": { in: 1, out: 5 },
};
function priceFor(model: string): { in: number; out: number } {
  const key = Object.keys(PRICES).find((p) => model.startsWith(p));
  return key ? PRICES[key] : PRICES["claude-sonnet"];
}

async function logUsage(feature: string, model: string, inTok: number, outTok: number) {
  try {
    const p = priceFor(model);
    const cost = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
    const svc = createServiceClient();
    await svc.from("ai_usage").insert({ feature, model, input_tokens: inTok, output_tokens: outTok, cost_usd: Number(cost.toFixed(5)) });
    await maybeSpendAlert(svc, cost);
  } catch {
    // never let usage logging break an AI call
  }
}

// Running month-to-date spend (site_settings ai_spend:<YYYY-MM>); email the admin
// once when it first crosses the monthly cap (ai_monthly_cap_usd).
async function maybeSpendAlert(svc: ReturnType<typeof createServiceClient>, cost: number) {
  const get = async (k: string) => (await svc.from("site_settings").select("value").eq("key", k).maybeSingle()).data?.value as string | undefined;
  const cap = Number(await get("ai_monthly_cap_usd")) || 0;
  const month = new Date().toISOString().slice(0, 7);
  const spendKey = `ai_spend:${month}`;
  const prev = Number(await get(spendKey)) || 0;
  const total = prev + cost;
  await svc.from("site_settings").upsert({ key: spendKey, value: String(total.toFixed(5)) }, { onConflict: "key" });
  if (cap > 0 && total >= cap && prev < cap) {
    const to = (await get("ai_alert_email")) || "";
    if (to) {
      const { sendEmail } = await import("@/lib/notify");
      await sendEmail(
        to,
        "⚠️ 121 CA Classes — AI monthly budget reached",
        `<p>Your AI spend this month has reached <strong>$${total.toFixed(2)}</strong> (cap $${cap.toFixed(2)}).</p><p>Review the breakdown in Admin → AI usage &amp; cost.</p>`,
      );
    }
  }
}

type CallOpts = { model?: string; feature?: string };

async function callClaude(system: string, user: string, maxTokens = 1024, opts: CallOpts = {}): Promise<string | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  const model = opts.model || (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage(opts.feature || "other", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

const ASSISTANT_SYSTEM =
  "You are the AI study assistant for 121 CA Classes, the CA-coaching venture of CA Parveen Sharma. " +
  "You help Indian CA (Foundation/Intermediate/Final) students with clear, accurate, exam-focused explanations. " +
  "Be concise and step-by-step, use Indian accounting/tax/law context, and reference relevant standards or sections where useful. " +
  "If a question is outside the CA syllabus or you are unsure, say so and suggest asking the faculty. " +
  "You assist under CA Parveen Sharma's guidance — never claim to be a human teacher.";

export async function answerDoubt(question: string, context?: string): Promise<string | null> {
  const user = (context ? `Topic context: ${context}\n\n` : "") + `Student's doubt: ${question}`;
  return callClaude(ASSISTANT_SYSTEM, user, 1024, { model: await fastModel(), feature: "doubt" });
}

// Sentinel the model returns when the repository doesn't cover the question.
export const NEED_FACULTY = "NEED_FACULTY";

const REPO_SYSTEM =
  "You are the study assistant for 121 CA Classes (CA Parveen Sharma). Answer the student's question " +
  "USING ONLY the study material provided below (transcripts, books, ICAI material). " +
  "Do not use outside knowledge. If the material does not contain enough to answer confidently, " +
  `reply with exactly "${NEED_FACULTY}" and nothing else. ` +
  "Otherwise answer clearly and step-by-step in Indian CA exam context, citing the relevant part of the material.";

// Answer strictly from the repository material. Returns the answer, the literal
// NEED_FACULTY sentinel (escalate to faculty), or null if AI/material unavailable.
export async function answerDoubtFromMaterial(
  question: string,
  material: string,
): Promise<string | null> {
  if (!material.trim()) return null;
  const user = `STUDY MATERIAL:\n${material}\n\nSTUDENT QUESTION:\n${question}`;
  return callClaude(REPO_SYSTEM, user, 1024, { model: await fastModel(), feature: "doubt" });
}

// From a student's recent questions, pull the specific CA topics/standards they
// seem to be struggling with — as short search terms to match against the catalog.
export async function extractConcepts(questionsText: string): Promise<string[]> {
  const sys =
    "From the student's questions below, list 2–5 specific CA exam topics, standards or concepts they seem to be struggling with. " +
    'Reply ONLY as a compact JSON array of short search terms, e.g. ["IND AS 115","revenue recognition","AS 24"]. No prose.';
  const out = await callClaude(sys, questionsText, 200, { model: await fastModel(), feature: "recommend" });
  if (!out) return [];
  try {
    const arr = JSON.parse(out.replace(/```json|```/g, "").trim());
    return Array.isArray(arr) ? arr.slice(0, 5).map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// A model/suggested answer a student could write to score full marks.
export async function suggestedAnswer(
  prompt: string,
  maxMarks: number,
  material: string,
): Promise<string | null> {
  const sys =
    "You are an ICAI exam expert for 121 CA Classes. Write a concise, well-structured MODEL ANSWER a student could write to score full marks for the question, using Indian CA exam conventions and citing the relevant standards/sections. Keep it proportional to the marks. If study material is provided, ground the answer in it.";
  const user = `QUESTION (${maxMarks} marks): ${prompt}` + (material ? `\n\nSTUDY MATERIAL:\n${material}` : "");
  return callClaude(sys, user, 1200, { feature: "suggested_answer" });
}

// AI mock interviewer for CA articleship/placement. The client passes the
// running transcript; we give brief feedback on the last answer + the next
// question, or a final assessment when the interview is ending.
export async function interviewReply(transcript: string): Promise<string | null> {
  const sys =
    "You are a professional but encouraging interviewer for a CA articleship/job at an Indian CA firm. " +
    "Conduct a realistic mock interview covering technical (accounting, audit, tax, law), practical and HR questions. " +
    "On each turn: give 1–2 lines of constructive feedback on the candidate's LAST answer, then ask exactly ONE next question. Keep it short. " +
    "If the transcript has 6 or more candidate answers, or contains 'END INTERVIEW', instead give a FINAL ASSESSMENT: strengths, what to improve, and a readiness score out of 10. " +
    "If the transcript is empty, just warmly greet and ask the first question.";
  return callClaude(sys, transcript || "(start the interview)", 600, { model: await fastModel(), feature: "interview" });
}

// Polish a CV summary/objective into crisp professional lines.
export async function improveSummary(text: string): Promise<string | null> {
  if (!text.trim()) return null;
  const sys =
    "Rewrite the following CA student's CV summary/objective into 2–3 crisp, professional sentences suitable for an Indian CA articleship/job CV. Keep it truthful to what's given; no fluff. Return only the rewritten text.";
  return callClaude(sys, text, 400, { model: await fastModel(), feature: "cv" });
}

const ASSIST_SYSTEM =
  "You are the friendly assistant for 121 CA Classes (CA Parveen Sharma). You answer two kinds of questions:\n" +
  "1) PORTAL/LOGISTICS (faculty names, courses, when classes or live sessions start, contact, plans, how to do something on the site) — answer ONLY from the SITE INFO section.\n" +
  "2) CA SUBJECT DOUBTS — answer ONLY from the STUDY MATERIAL section.\n" +
  "Be concise, warm and specific. If a subject doubt is not covered by the study material, reply exactly with " +
  `"${NEED_FACULTY}". For portal questions, if the SITE INFO doesn't contain the answer, say you're not sure and point them to help@121caclasses.com. Never invent facts.`;

// The "Ask me" assistant: handles both portal questions (from site facts) and
// CA doubts (from repository material) in one call. Returns the answer or the
// NEED_FACULTY sentinel (subject doubt not in material → send to faculty).
export async function answerAssistant(
  question: string,
  siteFacts: string,
  material: string,
): Promise<string | null> {
  const user = `SITE INFO:\n${siteFacts}\n\nSTUDY MATERIAL:\n${material || "(none provided)"}\n\nQUESTION:\n${question}`;
  return callClaude(ASSIST_SYSTEM, user, 900, { model: await fastModel(), feature: "ask_me" });
}

// Pre-generate MCQs from a class transcript (token-frugal: run ONCE at upload
// time, store the questions, serve them statically to every student). Returns
// null when AI is unconfigured or the response can't be parsed.
export async function generateMcqs(
  transcript: string,
  count: number,
  topic?: string,
): Promise<
  { question: string; options: string[]; correct_index: number; why_correct: string; why_wrong: string[] }[] | null
> {
  const n = Math.max(1, Math.min(25, Math.round(count) || 10));
  const system =
    `You are an ICAI exam question setter for 121 CA Classes (CA Parveen Sharma). ` +
    `From the lecture transcript, write exactly ${n} exam-style multiple-choice questions for Indian CA students` +
    (topic ? ` on "${topic}"` : "") +
    `. Each question has exactly 4 options with ONE correct answer. Test conceptual understanding and application (not trivia); use Indian accounting/tax/law context and reference standards/sections where useful. ` +
    `For EACH question also explain WHY the correct option is correct, and for EACH option a short reason WHY it is right or wrong (one line each, same order as options). ` +
    `Respond ONLY as compact JSON, no prose, no code fences: ` +
    `{"questions":[{"question":"...","options":["...","...","...","..."],"correct_index":0,"why_correct":"...","why_options":["why opt1","why opt2","why opt3","why opt4"]}]} ` +
    `where correct_index is the 0-based index of the correct option and why_options has one reason per option in the same order.`;
  const user = `Transcript:\n${transcript.slice(0, 24000)}`;
  const text = await callClaude(system, user, 6000, { feature: "generate_mcq" });
  if (!text) return null;
  try {
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    const arr = Array.isArray(json) ? json : json.questions;
    if (!Array.isArray(arr)) return null;
    return arr
      .map((q: { question?: unknown; options?: unknown; correct_index?: unknown; why_correct?: unknown; why_options?: unknown }) => {
        const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean);
        const why_wrong = (Array.isArray(q.why_options) ? q.why_options : []).map((o) => String(o ?? "").trim());
        return {
          question: String(q.question ?? "").trim(),
          options,
          correct_index: Number.isInteger(q.correct_index) ? (q.correct_index as number) : 0,
          why_correct: String(q.why_correct ?? "").trim(),
          why_wrong,
        };
      })
      .filter((q) => q.question && q.options.length >= 2 && q.correct_index < q.options.length);
  } catch {
    return null;
  }
}

// Pre-generate descriptive (subjective) exam questions from a transcript.
export async function generateSubjectiveQuestions(
  transcript: string,
  count: number,
  topic?: string,
): Promise<{ prompt: string; max_marks: number; model_answer: string }[] | null> {
  const n = Math.max(1, Math.min(15, Math.round(count) || 5));
  const system =
    `You are an ICAI exam paper setter for 121 CA Classes (CA Parveen Sharma). ` +
    `From the lecture transcript, write exactly ${n} descriptive/long-form CA exam questions for Indian CA students` +
    (topic ? ` on "${topic}"` : "") +
    `. Mix practical/numerical and conceptual questions in ICAI exam style; assign realistic marks (4-16 each). ` +
    `For EACH question also provide a concise MODEL ANSWER a student could write to score full marks (exam conventions, cite standards/sections). ` +
    `Respond ONLY as compact JSON, no prose, no code fences: ` +
    `{"questions":[{"prompt":"...","max_marks":8,"model_answer":"..."}]}.`;
  const user = `Transcript:\n${transcript.slice(0, 24000)}`;
  const text = await callClaude(system, user, 6000, { feature: "generate_subjective" });
  if (!text) return null;
  try {
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    const arr = Array.isArray(json) ? json : json.questions;
    if (!Array.isArray(arr)) return null;
    return arr
      .map((q: { prompt?: unknown; max_marks?: unknown; model_answer?: unknown }) => ({
        prompt: String(q.prompt ?? "").trim(),
        max_marks: Number.isFinite(Number(q.max_marks)) ? Math.max(1, Math.min(100, Math.round(Number(q.max_marks)))) : 10,
        model_answer: String(q.model_answer ?? "").trim(),
      }))
      .filter((q) => q.prompt.length > 0);
  } catch {
    return null;
  }
}

export async function gradeSubjective(
  prompt: string,
  answer: string,
  maxMarks: number | null,
  rubric?: { point: string; marks: number }[] | null,
  modelAnswer?: string | null,
): Promise<{ score: number | null; feedback: string } | null> {
  const mm = maxMarks ?? 10;
  const scheme = (rubric ?? []).filter((r) => r && r.point);
  const schemeText = scheme.length
    ? `\n\nMarking scheme — award marks STRICTLY against these points (do not invent your own):\n${scheme.map((r) => `- ${r.point} (${r.marks} marks)`).join("\n")}`
    : "";
  const modelText = modelAnswer ? `\n\nModel answer (the ideal answer to compare against):\n${modelAnswer}` : "";
  const system =
    `You are an ICAI subject examiner for 121 CA Classes. Evaluate the student's answer the way a CA exam examiner would, out of ${mm} marks. ` +
    (scheme.length
      ? `Award marks point-by-point using ONLY the marking scheme provided; the feedback must say which points were earned and which were missed. `
      : "") +
    `Respond ONLY as compact JSON, no prose, no code fences: {"score": <integer 0-${mm}>, "feedback": "<a short structured report: ✅ What was correct: …; ❌ What was wrong/missing: …; 📘 Concept to revise: <name the specific concept/standard/section>; 🎯 How to improve: <one concrete next step / what to study again>>"}.`;
  const user = `Question (max ${mm} marks): ${prompt}${schemeText}${modelText}\n\nStudent's answer:\n${answer}`;
  const text = await callClaude(system, user, 700, { feature: "grade" });
  if (!text) return null;
  try {
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    const score =
      typeof json.score === "number" ? Math.max(0, Math.min(mm, Math.round(json.score))) : null;
    return { score, feedback: String(json.feedback ?? "").trim() };
  } catch {
    return { score: null, feedback: text.slice(0, 800) };
  }
}

// Read a class transcript and summarise it: overview, how many questions were
// solved, the homework given, and the key concepts. Run ONCE at upload time.
export async function summarizeClass(
  transcript: string,
): Promise<{ summary: string; questions_count: number; homework: string; key_points: string[] } | null> {
  if (!transcript.trim()) return null;
  const sys =
    "You are an academic assistant for 121 CA Classes. From the class transcript below, produce a concise study summary for revision. " +
    'Respond ONLY as compact JSON, no prose, no code fences: {"summary":"<3-5 sentence overview of what the class covered>","questions_count":<number of questions/problems solved in the class>,"homework":"<the homework given to students, or empty string>","key_points":["<important concept/standard/section 1>","<concept 2>", "..."]}.';
  const text = await callClaude(sys, `Transcript:\n${transcript.slice(0, 24000)}`, 900, { feature: "summarize" });
  if (!text) return null;
  try {
    const j = JSON.parse(text.replace(/```json|```/g, "").trim());
    return {
      summary: String(j.summary ?? "").trim(),
      questions_count: Number(j.questions_count) || 0,
      homework: String(j.homework ?? "").trim(),
      key_points: Array.isArray(j.key_points) ? j.key_points.map((x: unknown) => String(x).trim()).filter(Boolean) : [],
    };
  } catch {
    return null;
  }
}
