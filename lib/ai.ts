// Claude (Anthropic) integration — SERVER-ONLY. Degrades gracefully: when
// ANTHROPIC_API_KEY is absent, AI calls return null and the app falls back to
// "our faculty will review this".

import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";

export async function aiConfigured(): Promise<boolean> {
  return Boolean(await getSecret("ANTHROPIC_API_KEY"));
}

// ----- Per-feature on/off switches (admin cost control) -----
// The admin can disable individual AI services from Admin → AI usage & cost.
// Disabled feature keys are stored as a JSON array in
// site_settings.ai_disabled_features. A disabled feature's AI call returns null,
// so the app falls back gracefully (e.g. "faculty will review"). Default: all on.
export const AI_TOGGLES: { key: string; label: string; desc: string }[] = [
  { key: "doubt", label: "Answer student doubts", desc: "AI replies to doubts on class pages & Telegram (otherwise sent to faculty)." },
  { key: "ask_me", label: "“Ask me” assistant", desc: "The website / portal help box." },
  { key: "grade", label: "Evaluate typed descriptive answers", desc: "AI marks typed subjective answers (otherwise faculty reviews them)." },
  { key: "grade_descriptive", label: "Evaluate handwritten paper (PDF)", desc: "AI reads a student's uploaded handwritten answer PDF and grades it against your solution PDF." },
  { key: "generate_mcq", label: "Generate MCQ tests", desc: "Create MCQs from a transcript / the AI repository." },
  { key: "import_mcq_pdf", label: "Read uploaded MCQ PDFs", desc: "Digitise your own MCQ test PDFs into the engine." },
  { key: "generate_subjective", label: "Generate descriptive tests", desc: "Create long-form questions from a transcript." },
  { key: "suggested_answer", label: "Suggested model answers", desc: "Draft a full-marks model answer." },
  { key: "summarize", label: "Class summaries", desc: "Summarise a class from its transcript." },
  { key: "transcribe", label: "Handwritten notes → typed", desc: "Convert a handwritten-notes PDF into typed notes." },
  { key: "recommend", label: "Study recommendations", desc: "Personalised topic recommendations." },
  { key: "interview", label: "AI mock interview", desc: "Career-corner interview practice." },
  { key: "cv", label: "CV summary polish", desc: "Improve a CV summary / objective." },
];

let _aiDisabled: { at: number; set: Set<string> } | null = null;
async function aiDisabledSet(): Promise<Set<string>> {
  const now = Date.now();
  if (_aiDisabled && now - _aiDisabled.at < 30000) return _aiDisabled.set;
  try {
    const { data } = await createServiceClient()
      .from("site_settings")
      .select("value")
      .eq("key", "ai_disabled_features")
      .maybeSingle();
    const arr = JSON.parse((data?.value as string) || "[]");
    const set = new Set<string>(Array.isArray(arr) ? arr.map(String) : []);
    _aiDisabled = { at: now, set };
    return set;
  } catch {
    return _aiDisabled?.set ?? new Set<string>();
  }
}

// True when AI is configured AND this feature isn't switched off by the admin.
export async function aiFeatureEnabled(feature: string): Promise<boolean> {
  if (!(await aiConfigured())) return false;
  return !(await aiDisabledSet()).has(feature);
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
  // Admin kill-switch: a disabled feature makes no AI call at all.
  if (opts.feature && opts.feature !== "other" && (await aiDisabledSet()).has(opts.feature)) return null;
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
  "ALWAYS answer in short bullet points (never paragraphs) and keep the WHOLE answer under 100 words. " +
  "Use Indian accounting/tax/law context, and reference relevant standards or sections where useful. " +
  "If a question is outside the CA syllabus or you are unsure, say so and suggest asking the faculty. " +
  "You assist under CA Parveen Sharma's guidance — never claim to be a human teacher.";

export async function answerDoubt(question: string, context?: string): Promise<string | null> {
  const user = (context ? `Topic context: ${context}\n\n` : "") + `Student's doubt: ${question}`;
  return callClaude(ASSISTANT_SYSTEM, user, 260, { model: await fastModel(), feature: "doubt" });
}

// Sentinel the model returns when the repository doesn't cover the question.
export const NEED_FACULTY = "NEED_FACULTY";

const REPO_SYSTEM =
  "You are the study assistant for 121 CA Classes (CA Parveen Sharma). Answer the student's question " +
  "USING ONLY the study material provided below (transcripts, books, ICAI material). " +
  "Do not use outside knowledge. If the material does not contain enough to answer confidently, " +
  `reply with exactly "${NEED_FACULTY}" and nothing else. ` +
  "Otherwise answer in short bullet points (never paragraphs), keeping the WHOLE answer under 100 words, " +
  "in Indian CA exam context, citing the relevant part of the material.";

// Answer strictly from the repository material. Returns the answer, the literal
// NEED_FACULTY sentinel (escalate to faculty), or null if AI/material unavailable.
export async function answerDoubtFromMaterial(
  question: string,
  material: string,
): Promise<string | null> {
  if (!material.trim()) return null;
  const user = `STUDY MATERIAL:\n${material}\n\nSTUDENT QUESTION:\n${question}`;
  return callClaude(REPO_SYSTEM, user, 260, { model: await fastModel(), feature: "doubt" });
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
  "You are the WEBSITE / PORTAL assistant for CA Parveen Sharma's coaching site. " +
  "You ONLY handle questions about the website and logistics — courses, plans/fees, when classes or live sessions start, how to do something on the site, login/technical issues, contact. Answer ONLY from the SITE INFO section. " +
  "If the question is a CA SUBJECT DOUBT (a concept, problem, standard, section, numerical), DO NOT answer it — reply EXACTLY: " +
  "\"For subject doubts, please use the 'Ask your doubts' button on your subject page — it answers from your class material and can pass it to the faculty.\" " +
  "Answer in short bullet points (never paragraphs), warm and specific, under 100 words. " +
  "If the SITE INFO doesn't contain the answer, say you're not sure and point them to mail@caparveensharma.com. Never invent facts.";

// The "Ask me" assistant: handles both portal questions (from site facts) and
// CA doubts (from repository material) in one call. Returns the answer or the
// NEED_FACULTY sentinel (subject doubt not in material → send to faculty).
export async function answerAssistant(
  question: string,
  siteFacts: string,
  material: string,
): Promise<string | null> {
  const user = `SITE INFO:\n${siteFacts}\n\nSTUDY MATERIAL:\n${material || "(none provided)"}\n\nQUESTION:\n${question}`;
  return callClaude(ASSIST_SYSTEM, user, 260, { model: await fastModel(), feature: "ask_me" });
}

// Pre-generate MCQs from a class transcript (token-frugal: run ONCE at upload
// time, store the questions, serve them statically to every student). Returns
// null when AI is unconfigured or the response can't be parsed.
export async function generateMcqs(
  transcript: string,
  count: number,
  topic?: string,
): Promise<
  { question: string; options: string[]; correct_index: number; why_correct: string; why_wrong: string[]; concept: string }[] | null
> {
  const n = Math.max(1, Math.min(25, Math.round(count) || 10));
  const system =
    `You are an ICAI exam question setter for 121 CA Classes (CA Parveen Sharma). ` +
    `From the lecture transcript, write exactly ${n} exam-style multiple-choice questions for Indian CA students` +
    (topic ? ` on "${topic}"` : "") +
    `. Each question has exactly 4 options with ONE correct answer. Test conceptual understanding and application (not trivia); use Indian accounting/tax/law context and reference standards/sections where useful. ` +
    `Tag each question with the single "concept" it tests. ` +
    `For EACH question also explain WHY the correct option is correct, and for EACH option a short reason WHY it is right or wrong. Keep EVERY explanation to ONE short line under 25 words (no paragraphs). ` +
    `Respond ONLY as compact JSON, no prose, no code fences, ASCII punctuation only: ` +
    `{"questions":[{"concept":"...","question":"...","options":["...","...","...","..."],"correct_index":0,"why_correct":"...","why_options":["why opt1","why opt2","why opt3","why opt4"]}]} ` +
    `where correct_index is the 0-based index of the correct option and why_options has one reason per option in the same order.`;
  const user = `Transcript:\n${transcript.slice(0, 24000)}`;
  const text = await callClaude(system, user, 6000, { feature: "generate_mcq" });
  if (!text) return null;
  try {
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    const arr = Array.isArray(json) ? json : json.questions;
    if (!Array.isArray(arr)) return null;
    return arr
      .map((q: { question?: unknown; options?: unknown; correct_index?: unknown; why_correct?: unknown; why_options?: unknown; concept?: unknown }) => {
        const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean);
        const why_wrong = (Array.isArray(q.why_options) ? q.why_options : []).map((o) => String(o ?? "").trim());
        return {
          concept: String(q.concept ?? "").trim(),
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

export const JOB_CATEGORIES = ["Articleship", "Fresher CA", "Experienced CA", "Industry / Corporate", "Audit firm", "Internship", "Other"] as const;

// Categorise an opening from its title/snippet with reliable keyword rules
// (instant, free, and consistent — beats an LLM that often returns "Other").
export function categorizeJob(title: string, snippet?: string): string {
  const t = `${title} ${snippet ?? ""}`.toLowerCase();
  if (/article\s?ship|article\s?assistant|article\s?trainee|ca\s?article/.test(t)) return "Articleship";
  if (/\bintern(ship)?\b/.test(t)) return "Internship";
  if (/manager|senior|sr\.?\b|lead|head|director|controller|principal|experienced|[5-9]\+?\s*years?|1[0-9]\s*years?/.test(t)) return "Experienced CA";
  if (/fresher|trainee|entry[-\s]?level|graduate|0\s*-\s*[12]\s*years?|qualified ca/.test(t)) return "Fresher CA";
  if (/audit|assurance|ca firm|chartered accountant firm|articled/.test(t)) return "Audit firm";
  if (/finance|account|taxation|gst|analyst|industry|corporate|controller|treasury/.test(t)) return "Industry / Corporate";
  return "Other";
}

// Batch helper (kept async for the existing call site). No AI cost.
export async function classifyJobs(jobs: { title: string; company?: string; snippet?: string }[]): Promise<string[]> {
  return jobs.map((j) => categorizeJob(j.title, j.snippet));
}

// Convert a handwritten-notes PDF into clean typed notes (Markdown) using
// Claude's vision. Run ONCE at admin level; the result goes to faculty for
// approval before students see it.
export async function transcribeHandwriting(pdfUrl: string): Promise<string | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !pdfUrl) return null;
  if ((await aiDisabledSet()).has("transcribe")) return null;
  const model = (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
  try {
    const pdfRes = await fetch(pdfUrl, { cache: "no-store" });
    if (!pdfRes.ok) return null;
    const b64 = Buffer.from(await pdfRes.arrayBuffer()).toString("base64");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        system:
          "You convert handwritten CA class notes into clean, well-structured TYPED notes in Markdown. " +
          "Preserve headings, sub-points, numbering, formulas, journal entries and the original order. " +
          "Use Indian CA conventions. Output ONLY the typed notes — no commentary, no preamble.",
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
              { type: "text", text: "Convert these handwritten notes into clean typed notes." },
            ],
          },
        ],
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("transcribe", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
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

// Read a teacher-supplied MCQ test PDF and convert it into engine questions —
// ONCE, at upload. This is pure DIGITISATION: it extracts exactly what the PDF
// contains and NEVER solves, judges, corrects, adds, removes or rewords anything.
// The correct option is whatever the document marks as the answer (the teacher's
// own answer key) — even if that answer is wrong, it is kept as-is. Any solution
// text in the PDF is copied faithfully. Returns null when AI is off / PDF unreadable.
export type ExtractedMcq = {
  question: string;
  options: string[];
  correct_index: number; // 0-based into options; -1 if the PDF marks no answer
  concept: string;
  solution: string;
};
export async function extractMcqsFromPdf(pdfUrl: string): Promise<ExtractedMcq[] | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !pdfUrl) return null;
  if ((await aiDisabledSet()).has("import_mcq_pdf")) return null;
  const model = (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
  const sys =
    "You DIGITISE a multiple-choice test that the teacher (CA Parveen Sharma) has ALREADY written, with the correct answers ALREADY marked. " +
    "Your ONLY job is faithful extraction. You MUST NOT solve the questions, MUST NOT judge, correct or change the marked answer, and MUST NOT add, remove, reword or 'fix' any question, option, answer or solution — even if you believe an answer is wrong, keep EXACTLY what the teacher wrote and marked. " +
    "Identify the correct option only from how the document marks it (a tick/✓/star, bold, underline, 'Ans:', 'Answer:', or a separate answer key). " +
    "If a question has NO answer marked anywhere in the document, set correct_index to -1 (do NOT guess an answer). " +
    "If the document provides a solution/explanation for a question, copy it faithfully into 'solution' (keep it concise but do not invent); otherwise leave 'solution' empty. " +
    "If a topic/concept/standard/section is stated for a question, put it in 'concept'; otherwise leave it empty. " +
    "Respond ONLY as compact JSON, no prose, no code fences: " +
    '{"questions":[{"question":"...","options":["...","...","...","..."],"correct_index":0,"concept":"","solution":""}]} ' +
    "where correct_index is the 0-based index into options of the answer the document marks.";
  try {
    const pdfRes = await fetch(pdfUrl, { cache: "no-store" });
    if (!pdfRes.ok) return null;
    const b64 = Buffer.from(await pdfRes.arrayBuffer()).toString("base64");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        system: sys,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
              { type: "text", text: "Extract every MCQ from this test exactly as written, with the answer the document marks." },
            ],
          },
        ],
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("import_mcq_pdf", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();
    if (!text) return null;
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    const arr = Array.isArray(json) ? json : json.questions;
    if (!Array.isArray(arr)) return null;
    return arr
      .map((q: { question?: unknown; options?: unknown; correct_index?: unknown; concept?: unknown; solution?: unknown }) => {
        const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean);
        const ci = Number.isInteger(q.correct_index) ? (q.correct_index as number) : -1;
        return {
          question: String(q.question ?? "").trim(),
          options,
          correct_index: ci,
          concept: String(q.concept ?? "").trim(),
          solution: String(q.solution ?? "").trim(),
        };
      })
      .filter((q) => q.question && q.options.length >= 2);
  } catch {
    return null;
  }
}

// Grade a student's HANDWRITTEN answer paper (PDF of photos) against the
// teacher's official solution PDF — ONCE, when they submit. Claude reads the
// handwriting (vision), matches it to the official solution and ICAI marking
// conventions, and returns per-question marks + improvement points + concepts to
// revise. It never invents answers the student didn't write. null when off/unreadable.
export type PaperAnnotation = { page: number; y: number; kind: "right" | "wrong" | "partial" | "tip"; note: string };
export type DescriptiveGrade = {
  awarded: number;
  total: number;
  summary: string;
  per_question: { q: string; awarded: number; max: number; comment: string }[];
  improvements: string[];
  concepts_to_revise: string[];
  annotations: PaperAnnotation[];
  unreadable: boolean;
};
export async function gradeDescriptivePaper(
  studentPdfUrl: string,
  solutionPdfUrl: string,
  totalMarks?: number | null,
): Promise<DescriptiveGrade | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !studentPdfUrl || !solutionPdfUrl) return null;
  if ((await aiDisabledSet()).has("grade_descriptive")) return null;
  const model = (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
  try {
    const [stu, sol] = await Promise.all([
      fetch(studentPdfUrl, { cache: "no-store" }),
      fetch(solutionPdfUrl, { cache: "no-store" }),
    ]);
    if (!stu.ok || !sol.ok) return null;
    const [stuB64, solB64] = await Promise.all([
      stu.arrayBuffer().then((b) => Buffer.from(b).toString("base64")),
      sol.arrayBuffer().then((b) => Buffer.from(b).toString("base64")),
    ]);
    const sys =
      "You are CA Parveen Sharma's examiner checking a CA descriptive (subjective) answer paper. " +
      "You are given TWO PDFs: FIRST the STUDENT'S HANDWRITTEN answer book (read the handwriting carefully — it may be untidy or rotated), and SECOND the teacher's OFFICIAL SOLUTION / answer key. " +
      "Grade the student's answers ONLY against the official solution and standard ICAI marking conventions. Mark question-by-question, fairly but exam-strict — give partial marks for partially-correct steps. " +
      (totalMarks
        ? `The paper is out of ${totalMarks} total marks; distribute marks across the questions sensibly. `
        : "Use the marks indicated for each question in the paper/solution. ") +
      "For EACH question: the marks awarded, the max marks, and a one-line comment. Then overall: improvement points (where marks were lost / what went wrong) and the specific concepts / accounting standards / sections the student got wrong and must revise. " +
      "If part of the handwriting is genuinely unreadable, grade what you can, set \"unreadable\":true, and say so — NEVER invent answers the student did not write. " +
      "ALSO return \"annotations\": marks to place directly on the STUDENT's pages. For each, give the 1-based page number of the student's answer book, an approximate vertical position y (0.0 = top of that page, 1.0 = bottom), a kind (\"right\" = correct step, \"wrong\" = mistake, \"partial\" = partly right, \"tip\" = improvement/concept), and a SHORT note (under 12 words — the concept, the mistake, or the fix). Aim for 1–4 annotations per page, placed near where each point occurs. " +
      "Respond ONLY as compact JSON, no prose, no code fences: " +
      '{"awarded":<number>,"total":<number>,"summary":"<one-line overall>","per_question":[{"q":"Q1","awarded":4,"max":6,"comment":"..."}],"improvements":["..."],"concepts_to_revise":["..."],"annotations":[{"page":1,"y":0.25,"kind":"wrong","note":"AS 13 cost excludes brokerage"}],"unreadable":false}.';
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        system: sys,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "STUDENT'S HANDWRITTEN ANSWER BOOK (grade this):" },
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: stuB64 } },
              { type: "text", text: "OFFICIAL SOLUTION / ANSWER KEY (grade against this):" },
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: solB64 } },
              { type: "text", text: "Grade the student's paper now and return the JSON." },
            ],
          },
        ],
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("grade_descriptive", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();
    if (!text) return null;
    const j = JSON.parse(text.replace(/```json|```/g, "").trim());
    const arr = (x: unknown) => (Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : []);
    const pq = Array.isArray(j.per_question)
      ? j.per_question.map((p: { q?: unknown; awarded?: unknown; max?: unknown; comment?: unknown }) => ({
          q: String(p.q ?? "").trim(),
          awarded: Number(p.awarded) || 0,
          max: Number(p.max) || 0,
          comment: String(p.comment ?? "").trim(),
        }))
      : [];
    const validKinds = new Set(["right", "wrong", "partial", "tip"]);
    const annotations: PaperAnnotation[] = Array.isArray(j.annotations)
      ? j.annotations
          .map((a: { page?: unknown; y?: unknown; kind?: unknown; note?: unknown }) => ({
            page: Math.max(1, Math.round(Number(a.page) || 1)),
            y: Math.min(1, Math.max(0, Number(a.y) || 0)),
            kind: (validKinds.has(String(a.kind)) ? String(a.kind) : "tip") as PaperAnnotation["kind"],
            note: String(a.note ?? "").trim(),
          }))
          .filter((a: PaperAnnotation) => a.note)
      : [];
    return {
      awarded: Number.isFinite(Number(j.awarded)) ? Number(j.awarded) : pq.reduce((s: number, p: { awarded: number }) => s + p.awarded, 0),
      total: Number(j.total) || totalMarks || pq.reduce((s: number, p: { max: number }) => s + p.max, 0),
      summary: String(j.summary ?? "").trim(),
      per_question: pq,
      improvements: arr(j.improvements),
      concepts_to_revise: arr(j.concepts_to_revise),
      annotations,
      unreadable: Boolean(j.unreadable),
    };
  } catch {
    return null;
  }
}

// Read the "time allowed" and "maximum marks" printed on a question-paper PDF, so
// the teacher doesn't have to type them. Returns nulls for anything not clearly
// printed. One cheap call at upload time. Gated with the descriptive toggle.
export async function detectPaperMeta(questionPdfUrl: string): Promise<{ minutes: number | null; totalMarks: number | null } | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !questionPdfUrl) return null;
  if ((await aiDisabledSet()).has("grade_descriptive")) return null;
  const model = (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
  try {
    const r = await fetch(questionPdfUrl, { cache: "no-store" });
    if (!r.ok) return null;
    const b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
    const sys =
      "You are reading a CA exam/test question paper. Find the TIME ALLOWED and the MAXIMUM MARKS if printed on it (usually near the top). " +
      "Convert hours to minutes (e.g. '3 Hours' → 180; '1½ hours' → 90). If a value is not clearly printed, use null — do not guess. " +
      'Respond ONLY as compact JSON, no prose: {"minutes":<total minutes or null>,"total_marks":<maximum marks or null>}.';
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        system: sys,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
              { type: "text", text: "Extract the time allowed (in minutes) and the maximum marks." },
            ],
          },
        ],
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("grade_descriptive", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    const text = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n").trim();
    if (!text) return null;
    const j = JSON.parse(text.replace(/```json|```/g, "").trim());
    const minutes = Number(j.minutes);
    const total = Number(j.total_marks);
    return { minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null, totalMarks: Number.isFinite(total) && total > 0 ? Math.round(total) : null };
  } catch {
    return null;
  }
}

// Class summary built STRICTLY from the uploaded transcript (no outside
// knowledge): what was discussed, the concepts, how many homework questions
// were solved in class, and the homework set for next class. One-time; shown to
// students.
export type ClassSummary = {
  summary: string;
  questions_discussed: string[];
  concepts_discussed: string[];
  homework_covered_count: number;
  homework_next: string;
};
export async function summarizeClass(transcript: string): Promise<ClassSummary | null> {
  if (!transcript.trim()) return null;
  const sys =
    "You summarise a CA class for students using ONLY the transcript provided — never add outside knowledge. " +
    "Cover ONLY the academic content — concepts, standards, sections, questions and homework. " +
    "NEVER mention dates, days of the week, festivals, holidays, greetings, small talk, attendance, " +
    "technical/audio issues, or any other noise; ignore all such chatter in the transcript. " +
    "Respond ONLY as compact JSON, no prose, no code fences: " +
    '{"summary":"<3-5 short bullet points of what this class covered — each bullet on its own line starting with \\"- \\"; NO paragraphs>",' +
    '"questions_discussed":["<question/problem discussed in class 1>","..."],' +
    '"concepts_discussed":["<concept/standard/section discussed 1>","..."],' +
    '"homework_covered_count":<how many homework/practice questions were SOLVED during the class>,' +
    '"homework_next":"<the homework given in this class for the next class, or empty string>"}.';
  const text = await callClaude(sys, `Transcript:\n${transcript.slice(0, 24000)}`, 1200, { feature: "summarize" });
  if (!text) return null;
  try {
    const j = JSON.parse(text.replace(/```json|```/g, "").trim());
    const arr = (x: unknown) => (Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : []);
    return {
      summary: String(j.summary ?? "").trim(),
      questions_discussed: arr(j.questions_discussed),
      concepts_discussed: arr(j.concepts_discussed),
      homework_covered_count: Number(j.homework_covered_count) || 0,
      homework_next: String(j.homework_next ?? "").trim(),
    };
  } catch {
    return null;
  }
}
