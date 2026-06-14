// Claude (Anthropic) integration — SERVER-ONLY. Degrades gracefully: when
// ANTHROPIC_API_KEY is absent, AI calls return null and the app falls back to
// "our faculty will review this".

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

async function callClaude(system: string, user: string, maxTokens = 1024): Promise<string | null> {
  if (!aiConfigured()) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
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
  return callClaude(ASSISTANT_SYSTEM, user, 1024);
}

// Pre-generate MCQs from a class transcript (token-frugal: run ONCE at upload
// time, store the questions, serve them statically to every student). Returns
// null when AI is unconfigured or the response can't be parsed.
export async function generateMcqs(
  transcript: string,
  count: number,
  topic?: string,
): Promise<{ question: string; options: string[]; correct_index: number }[] | null> {
  const n = Math.max(1, Math.min(25, Math.round(count) || 10));
  const system =
    `You are an ICAI exam question setter for 121 CA Classes (CA Parveen Sharma). ` +
    `From the lecture transcript, write exactly ${n} exam-style multiple-choice questions for Indian CA students` +
    (topic ? ` on "${topic}"` : "") +
    `. Each question has exactly 4 options with ONE correct answer. Test conceptual understanding and application (not trivia); use Indian accounting/tax/law context and reference standards/sections where useful. ` +
    `Respond ONLY as compact JSON, no prose, no code fences: ` +
    `{"questions":[{"question":"...","options":["...","...","...","..."],"correct_index":0}]} ` +
    `where correct_index is the 0-based index of the correct option.`;
  const user = `Transcript:\n${transcript.slice(0, 24000)}`;
  const text = await callClaude(system, user, 4000);
  if (!text) return null;
  try {
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    const arr = Array.isArray(json) ? json : json.questions;
    if (!Array.isArray(arr)) return null;
    return arr
      .map((q: { question?: unknown; options?: unknown; correct_index?: unknown }) => ({
        question: String(q.question ?? "").trim(),
        options: (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim()).filter(Boolean),
        correct_index: Number.isInteger(q.correct_index) ? (q.correct_index as number) : 0,
      }))
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
): Promise<{ prompt: string; max_marks: number }[] | null> {
  const n = Math.max(1, Math.min(15, Math.round(count) || 5));
  const system =
    `You are an ICAI exam paper setter for 121 CA Classes (CA Parveen Sharma). ` +
    `From the lecture transcript, write exactly ${n} descriptive/long-form CA exam questions for Indian CA students` +
    (topic ? ` on "${topic}"` : "") +
    `. Mix practical/numerical and conceptual questions in ICAI exam style; assign realistic marks (4-16 each). ` +
    `Respond ONLY as compact JSON, no prose, no code fences: ` +
    `{"questions":[{"prompt":"...","max_marks":8}]}.`;
  const user = `Transcript:\n${transcript.slice(0, 24000)}`;
  const text = await callClaude(system, user, 3000);
  if (!text) return null;
  try {
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    const arr = Array.isArray(json) ? json : json.questions;
    if (!Array.isArray(arr)) return null;
    return arr
      .map((q: { prompt?: unknown; max_marks?: unknown }) => ({
        prompt: String(q.prompt ?? "").trim(),
        max_marks: Number.isFinite(Number(q.max_marks)) ? Math.max(1, Math.min(100, Math.round(Number(q.max_marks)))) : 10,
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
): Promise<{ score: number | null; feedback: string } | null> {
  const mm = maxMarks ?? 10;
  const system =
    `You are an ICAI subject examiner for 121 CA Classes. Evaluate the student's answer fairly, the way a CA exam examiner would, out of ${mm} marks. ` +
    `Respond ONLY as compact JSON, no prose, no code fences: {"score": <integer 0-${mm}>, "feedback": "<2-4 sentences: what was correct, what was missing, and one concrete improvement>"}.`;
  const user = `Question (max ${mm} marks): ${prompt}\n\nStudent's answer:\n${answer}`;
  const text = await callClaude(system, user, 700);
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
