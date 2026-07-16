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
  { key: "group_doubt", label: "Answer doubts in Telegram/Discord groups", desc: "AI replies (marked 🤖) only when a student TAGS the bot or replies to it — it never interrupts student discussions. Mirrored across platforms. Daily cap applies." },
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
  { key: "marketing", label: "Marketing pack generator & weekly autopilot", desc: "Writes multi-channel campaign packs (Telegram/WhatsApp + Instagram + YouTube) and powers the Monday autopilot on the Campaigns page." },
  { key: "articles", label: "SEO articles writer", desc: "Writes original public study articles from the topic queue (Admin → Articles). Original content only — never copied from the web." },
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
        "⚠️ CA Parveen Sharma — AI monthly budget reached",
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
  "You are the AI study assistant for CA Parveen Sharma (CA coaching). " +
  "You help Indian CA (Foundation/Intermediate/Final) students with clear, accurate, exam-focused explanations. " +
  "ALWAYS answer in short bullet points (never paragraphs) and keep the WHOLE answer under 100 words. " +
  "Use Indian accounting/tax/law context, and reference relevant standards or sections where useful. " +
  "If a question is outside the CA syllabus or you are unsure, say so and suggest asking the faculty. " +
  "You assist under CA Parveen Sharma's guidance — never claim to be a human teacher.";

export async function answerDoubt(question: string, context?: string): Promise<string | null> {
  const user = (context ? `Topic context: ${context}\n\n` : "") + `Student's doubt: ${question}`;
  return withBeta(await callClaude(ASSISTANT_SYSTEM, user, 260, { model: await fastModel(), feature: "doubt" }));
}

// Sentinel the model returns when the repository doesn't cover the question.
export const NEED_FACULTY = "NEED_FACULTY";

// Shown under every AI answer until the formal launch: sets expectations and
// protects trust if an answer is imperfect. Remove at launch.
export const BETA_NOTE =
  "⚠️ Beta version — the portal has not been formally launched yet. AI answers can make mistakes; please verify important points with the faculty.";

// Append the beta note to a successful AI answer (never to the NEED_FACULTY
// sentinel, which callers compare verbatim).
function withBeta(text: string | null): string | null {
  if (!text || text.trim() === NEED_FACULTY) return text;
  return `${text.trim()}\n\n${BETA_NOTE}`;
}

const REPO_SYSTEM =
  "You are the AI study assistant for CA Parveen Sharma's CA coaching, helping Indian CA " +
  "(Intermediate/Final) students. Use the STUDY MATERIAL below (class transcripts/digests — each labelled " +
  "with its 'Class N' number — plus notes, question banks, ICAI study material, RTP/MTP, past papers) as " +
  "your PRIMARY source, plus standard ICAI knowledge (AS, Ind AS, company law).\n" +
  "STYLE: Be as CONCISE as possible — well under 120 words for a normal doubt. Do NOT pad. Only write a " +
  "longer answer when the student explicitly asks you to SOLVE a specific/numbered question or full problem " +
  "— then give a complete step-by-step solution (working notes, journal entries, relevant AS/Ind AS/section) " +
  "and length may exceed 120 words as needed.\n" +
  "ALWAYS end with one short line telling the student WHICH CLASS to watch for this — use the 'Class N' " +
  "labels in the material, e.g. '📺 Covered in Class 42.' If several, name them; if you truly can't tell, omit it.\n" +
  "For 'solve question 15 of Amalgamation / Q6 of ICAI / question 10 of RTP May 2026': find it in the material " +
  "and solve fully. If it is NOT in the uploaded material, say so in one line and offer to solve if they paste it.\n" +
  `Only reply with exactly "${NEED_FACULTY}" if the request is genuinely NOT about the CA syllabus ` +
  "(personal, fees, login, or account matters).";

// Answer strictly from the repository material. Returns the answer, the literal
// NEED_FACULTY sentinel (escalate to faculty), or null if AI/material unavailable.
export async function answerDoubtFromMaterial(
  question: string,
  material: string,
  feature: string = "doubt", // "group_doubt" for Telegram-group answers (own toggle + cap)
): Promise<string | null> {
  // Enough room to actually SOLVE a numbered question (working notes, journal
  // entries), not just a one-line conceptual reply.
  const user = `STUDY MATERIAL:\n${material || "(none provided)"}\n\nSTUDENT QUESTION:\n${question}`;
  return withBeta(await callClaude(REPO_SYSTEM, user, 1400, { model: await fastModel(), feature }));
}

// Answer a doubt where the student ATTACHED an image or PDF (a photographed
// question, a screenshot, a problem PDF). Claude reads the attachment AND the
// typed text together, grounded in the same study material.
export async function answerDoubtWithAttachment(
  question: string,
  material: string,
  attachment: { dataB64: string; mediaType: string },
): Promise<string | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  if ((await aiDisabledSet()).has("doubt")) return null;
  const model = await fastModel();
  const isPdf = attachment.mediaType === "application/pdf";
  const block = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: attachment.dataB64 } }
    : { type: "image", source: { type: "base64", media_type: attachment.mediaType, data: attachment.dataB64 } };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 1400,
        system: REPO_SYSTEM,
        messages: [{
          role: "user",
          content: [
            block,
            { type: "text", text: `STUDY MATERIAL:\n${material || "(none provided)"}\n\nThe attached ${isPdf ? "PDF" : "image"} is part of the student's doubt — read it carefully. STUDENT'S TYPED MESSAGE:\n${question || "(see the attachment)"}` },
          ],
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const u = data.usage ?? {};
    await logUsage("doubt", model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0);
    const text = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n").trim();
    return withBeta(text || null);
  } catch {
    return null;
  }
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
    "You are an ICAI exam expert for CA Parveen Sharma. Write a concise, well-structured MODEL ANSWER a student could write to score full marks for the question, using Indian CA exam conventions and citing the relevant standards/sections. Keep it proportional to the marks. If study material is provided, ground the answer in it.";
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
  "If the SITE INFO doesn't contain the answer, say you're not sure and point them to contact@caparveensharma.com. Never invent facts.";

// The "Ask me" assistant: handles both portal questions (from site facts) and
// CA doubts (from repository material) in one call. Returns the answer or the
// NEED_FACULTY sentinel (subject doubt not in material → send to faculty).
export async function answerAssistant(
  question: string,
  siteFacts: string,
  material: string,
): Promise<string | null> {
  const user = `SITE INFO:\n${siteFacts}\n\nSTUDY MATERIAL:\n${material || "(none provided)"}\n\nQUESTION:\n${question}`;
  return withBeta(await callClaude(ASSIST_SYSTEM, user, 260, { model: await fastModel(), feature: "ask_me" }));
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
    `You are an ICAI exam question setter for CA Parveen Sharma. ` +
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

// ---- Case-study engine ----
// Parse ONE chunk of a case-studies PDF into structured cases. The PDF has
// numbered case scenarios, each followed by 5-7 MCQs, with the correct answers
// given in the PDF (after each question, after the case, or in an answer key).
// The model must return only COMPLETE cases and say how much of the chunk it
// consumed, so the driver can resume exactly where the last full case ended.
export type ParsedCase = {
  title: string;
  scenario: string;
  questions: { question: string; options: string[]; correct_index: number }[];
};
// Parse model JSON that may be wrapped in code fences OR truncated at the token
// limit. On a clean parse failure, salvage by trimming to the last complete
// object/array close — so a cut-off response still yields the cases it did emit.
function parseLooseJson(text: string): any | null {
  let s = text.replace(/```json|```/g, "").trim();
  const start = s.indexOf("{");
  if (start > 0) s = s.slice(start);
  try { return JSON.parse(s); } catch { /* try salvage */ }
  // Salvage a truncated "cases" array: keep whole case objects only.
  const m = s.match(/"cases"\s*:\s*\[/);
  if (!m) return null;
  const arrStart = (m.index ?? 0) + m[0].length;
  const objs: string[] = [];
  let depth = 0, objStart = -1, inStr = false, esc = false;
  for (let i = arrStart; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) objStart = i; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && objStart >= 0) { objs.push(s.slice(objStart, i + 1)); objStart = -1; } }
    else if (ch === "]" && depth === 0) break;
  }
  if (!objs.length) return null;
  try { return { cases: JSON.parse(`[${objs.join(",")}]`), consumed_chars: 0 }; } catch { return null; }
}

// "AI_DOWN" = the model call itself failed (no key / API error / rate limit) —
// caller should retry later, NOT skip content. null = we got a response but
// couldn't parse it (content problem) — caller may skip past it.
export async function parseCaseStudiesChunk(
  chunk: string,
  isLastChunk: boolean,
): Promise<{ cases: ParsedCase[]; consumed: number } | "AI_DOWN" | null> {
  const system =
    `You extract case studies from an Indian CA exam PDF (text below). The document contains numbered ` +
    `case-study scenarios, each followed by about 5-7 multiple-choice questions; the correct answers are ` +
    `stated in the document (marked with the question, listed after the case, or in an answer key). ` +
    `Extract every COMPLETE case study in this text chunk. Keep the scenario text faithful to the source ` +
    `(you may clean line-break artifacts). Each question: full text, all options in order, and the 0-based ` +
    `index of the correct option AS GIVEN IN THE DOCUMENT (never guess; if truly absent use -1). ` +
    (isLastChunk
      ? `This is the FINAL chunk — extract everything remaining. Set "consumed_chars" to the chunk length. `
      : `The chunk may END MID-CASE: exclude any incomplete trailing case, and set "consumed_chars" to the ` +
        `character offset where the last complete case ends, so parsing resumes there. `) +
    `Respond ONLY as compact JSON, no prose, no code fences: ` +
    `{"cases":[{"title":"Case 12 — <short name>","scenario":"...","questions":[{"question":"...","options":["...","..."],"correct_index":0}]}],"consumed_chars":12345}`;
  const text = await callClaude(system, chunk, 16000, { feature: "case_parse" });
  if (!text) return "AI_DOWN"; // API/config error — retry later, don't skip
  try {
    const json = parseLooseJson(text);
    if (!json) return null;
    const arr = Array.isArray(json.cases) ? json.cases : [];
    const cases: ParsedCase[] = arr
      .map((c: { title?: unknown; scenario?: unknown; questions?: unknown }) => ({
        title: String(c.title ?? "").trim(),
        scenario: String(c.scenario ?? "").trim(),
        questions: (Array.isArray(c.questions) ? c.questions : [])
          .map((q: { question?: unknown; options?: unknown; correct_index?: unknown }) => ({
            question: String(q.question ?? "").trim(),
            options: (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean),
            correct_index: Number.isInteger(q.correct_index) ? (q.correct_index as number) : -1,
          }))
          .filter((q: { question: string; options: string[] }) => q.question && q.options.length >= 2),
      }))
      .filter((c: ParsedCase) => c.scenario && c.questions.length > 0);
    const consumed = Number(json.consumed_chars);
    return { cases, consumed: Number.isFinite(consumed) && consumed > 0 ? Math.min(consumed, chunk.length) : chunk.length };
  } catch {
    return null;
  }
}

// Generate the per-question reasons for ONE case (why the correct option is
// right + why each option is right/wrong). Run once per case, cached in the DB.
export async function explainCaseAnswers(
  scenario: string,
  questions: { question: string; options: string[]; correct_index: number }[],
): Promise<{ why_correct: string; why_options: string[] }[] | null> {
  const system =
    `You are CA Parveen Sharma's teaching assistant. For each MCQ of this case study, explain in ` +
    `1-2 short lines WHY the correct option is correct, and for EVERY option one short line why it is ` +
    `right or wrong (cite the accounting standard / provision where useful). Respond ONLY as compact JSON: ` +
    `{"explanations":[{"why_correct":"...","why_options":["reason opt 1","reason opt 2",...]}]} ` +
    `— one entry per question, why_options in the same order as the options.`;
  const user =
    `CASE:\n${scenario.slice(0, 8000)}\n\nQUESTIONS:\n` +
    questions.map((q, i) => `${i + 1}. ${q.question}\nOptions: ${q.options.map((o, j) => `(${j + 1}) ${o}`).join(" ")}\nCorrect: option ${q.correct_index + 1}`).join("\n\n");
  const text = await callClaude(system, user, 4000, { feature: "case_explain" });
  if (!text) return null;
  try {
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    const arr = Array.isArray(json.explanations) ? json.explanations : [];
    return arr.map((e: { why_correct?: unknown; why_options?: unknown }) => ({
      why_correct: String(e.why_correct ?? "").trim(),
      why_options: (Array.isArray(e.why_options) ? e.why_options : []).map((o) => String(o ?? "").trim()),
    }));
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
    `You are an ICAI exam paper setter for CA Parveen Sharma. ` +
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
    `You are an ICAI subject examiner for CA Parveen Sharma. Evaluate the student's answer the way a CA exam examiner would, out of ${mm} marks. ` +
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
export async function transcribeHandwriting(pdfUrl: string, opts: { force?: boolean } = {}): Promise<string | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey || !pdfUrl) return null;
  // The realtime "transcribe" toggle gates the on-demand admin button; the
  // background knowledge-ingestion pass sets force:true to feed the AI regardless.
  if (!opts.force && (await aiDisabledSet()).has("transcribe")) return null;
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

// ---- Marketing campaign packs ------------------------------------------------
// One AI call → a multi-day, multi-channel campaign. Every post carries three
// variants: a Telegram/WhatsApp/Discord message, an Instagram caption with
// hashtags, and a YouTube community-post text. The copy rules enforce the
// founder's no-false-claims policy (only the approved facts below).
export type PackPost = {
  day: number;        // 0-based day offset from the start date
  focus: string;      // what this post promotes (shown to the admin)
  message: string;    // Telegram / WhatsApp / Discord text
  instagram: string;  // caption + hashtags
  youtube: string;    // community-post text
};

const PACK_SYSTEM =
  "You write marketing posts for CA Parveen Sharma's CA coaching platform (caparveensharma.com) aimed at Indian CA students (Foundation/Intermediate/Final). " +
  "STRICT RULES: never invent facts, numbers, discounts, deadlines or testimonials. The ONLY approved claims: " +
  "CA Parveen Sharma has 36 years of teaching experience; the platform offers a FREE day-by-day study planner, FREE chapter MCQ tests with rank & concept reports, case-study (case-scenario) practice for the new exam pattern, recorded classes, live classes, and a doubt-solving AI + faculty. " +
  "Tone: warm, encouraging senior-teacher voice; simple English with a light Indian touch; emojis welcome but not overdone. " +
  "Each day must take a DIFFERENT angle (a feature, a study tip that ends in the feature, a question to the reader, exam-mindset encouragement). Lead with FREE offerings. " +
  "Always include the exact link given for that focus. " +
  "Respond ONLY as compact JSON, no prose, no code fences: " +
  '{"posts":[{"day":0,"focus":"...","message":"...","instagram":"...","youtube":"..."}]}';

export async function generateCampaignPack(
  theme: string,
  days: number,
  context: string,
): Promise<PackPost[] | null> {
  const user =
    `Campaign theme: ${theme}\n` +
    `Number of daily posts: ${days}\n\n` +
    `Links to use (pick the one matching each post's focus; keep the ?src= tag):\n` +
    `- Free study planner: https://caparveensharma.com/free-planner?src=ig (use ?src=yt in the youtube text, ?src=tg in the message)\n` +
    `- Courses: https://caparveensharma.com/courses\n` +
    `- Live classes: https://caparveensharma.com/live\n\n` +
    `What's happening on the platform right now (mention when relevant, never invent more):\n${context}\n\n` +
    `Per-post limits: message ≤ 450 characters; instagram = caption ≤ 500 characters + 8-12 relevant hashtags on a new line; youtube ≤ 350 characters.`;
  const text = await callClaude(PACK_SYSTEM, user, Math.min(300 + days * 550, 8000), { feature: "marketing" });
  if (!text) return null;
  const json = parseLooseJson(text);
  const arr = Array.isArray(json?.posts) ? json.posts : null;
  if (!arr?.length) return null;
  return arr
    .map((p: { day?: unknown; focus?: unknown; message?: unknown; instagram?: unknown; youtube?: unknown }, i: number) => ({
      day: Number.isFinite(Number(p.day)) ? Number(p.day) : i,
      focus: String(p.focus ?? "").trim() || `Post ${i + 1}`,
      message: String(p.message ?? "").trim(),
      instagram: String(p.instagram ?? "").trim(),
      youtube: String(p.youtube ?? "").trim(),
    }))
    .filter((p: PackPost) => p.message.length > 0)
    .slice(0, Math.max(1, days));
}

// ---- SEO articles ------------------------------------------------------------
// Original educational articles for the public /articles section. Hard rules:
// never copy from any source, never invent statistics/dates/thresholds — where
// a rule may change, the article says "verify with the latest ICAI material".
export type WrittenArticle = { title: string; description: string; body_md: string };

const ARTICLE_SYSTEM =
  "You write ORIGINAL educational articles for caparveensharma.com, the CA coaching platform of CA Parveen Sharma (36 years of teaching experience). Audience: Indian CA students (Foundation/Intermediate/Final). " +
  "ABSOLUTE RULES: write 100% original prose — never reproduce text from ICAI materials, textbooks or websites. Never invent statistics, dates, fee amounts, section numbers or thresholds you are not certain of; where a rule/limit may have changed, write 'verify in the latest ICAI study material / announcement'. No fake testimonials or invented stories. " +
  "STYLE: a warm senior-teacher voice; simple English; short paragraphs; concrete worked LOGIC (not copied questions); markdown with ## and ### headings and bullet lists; 700–1000 words; end with a short '## FAQs' section (2–3 Q&As), then a final paragraph naturally pointing students to the free tools: the free day-by-day study planner at https://caparveensharma.com/free-planner?src=article and free case-scenario practice at https://caparveensharma.com (courses). " +
  "SEO: title ≤ 65 characters containing the main keyword; meta description ≤ 155 characters. " +
  'Respond ONLY as compact JSON, no prose, no code fences: {"title":"...","description":"...","body_md":"..."}';

export async function writeArticle(topic: string, keywords: string): Promise<WrittenArticle | null> {
  const user = `Article topic: ${topic}\nTarget keywords: ${keywords}\nWrite the article now.`;
  const text = await callClaude(ARTICLE_SYSTEM, user, 3200, { feature: "articles" });
  if (!text) return null;
  const json = parseLooseJson(text);
  const title = String(json?.title ?? "").trim();
  const body = String(json?.body_md ?? "").trim();
  if (!title || body.length < 400) return null;
  return { title, description: String(json?.description ?? "").trim(), body_md: body };
}

// Weekly trend scan → new article topics. Input: fresh headlines from the
// accounting world (Ind AS/ICAI/NFRA/SEBI/SFIO/forensic/scams). Output: NEW
// topics for the article queue, angled educationally for CA students, never
// duplicating what's already queued or written.
export type TrendTopic = { topic: string; category: string; keywords: string };

const TRENDS_SYSTEM =
  "You pick article topics for a CA-student education site (caparveensharma.com). From the news headlines given, propose up to 8 NEW article topics. " +
  "RULES: every topic must be from the ACCOUNTING world (accounting standards, ICAI, NFRA, SEBI accounting/audit matters, SFIO/CBI fraud investigations, forensic accounting, corporate accounting scams, industry accounting news). " +
  "Angle each topic educationally for CA students — 'what happened and what a CA student should learn from it' — not as journalism. " +
  "Do NOT duplicate or closely repeat any topic from the EXISTING list. Do not assume facts beyond the headline itself; the article writer will phrase uncertain details carefully. " +
  "Include the source headline inside keywords so the writer has context. category must be one of: fr | advanced-accounting | strategy | career | news (use 'news' for scams/NFRA/SEBI/forensic/current-affairs topics). " +
  'Respond ONLY as compact JSON: {"topics":[{"topic":"...","category":"news","keywords":"... | headline: ..."}]}';

export async function proposeTrendingTopics(headlines: string[], existing: string[]): Promise<TrendTopic[] | null> {
  const user =
    `FRESH HEADLINES (this week):\n${headlines.slice(0, 60).map((h) => `- ${h}`).join("\n")}\n\n` +
    `EXISTING topics (do not repeat):\n${existing.slice(0, 150).map((t) => `- ${t}`).join("\n")}`;
  const text = await callClaude(TRENDS_SYSTEM, user, 1800, { feature: "articles" });
  if (!text) return null;
  const json = parseLooseJson(text);
  const arr = Array.isArray(json?.topics) ? json.topics : null;
  if (!arr) return null;
  const CATS = ["fr", "advanced-accounting", "strategy", "career", "news"];
  return arr
    .map((t: { topic?: unknown; category?: unknown; keywords?: unknown }) => ({
      topic: String(t.topic ?? "").trim(),
      category: CATS.includes(String(t.category)) ? String(t.category) : "news",
      keywords: String(t.keywords ?? "").trim(),
    }))
    .filter((t: TrendTopic) => t.topic.length > 15)
    .slice(0, 8);
}
