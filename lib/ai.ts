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
  "You are the AI study assistant for 1:1 CA Classes, the CA-coaching venture of CA Parveen Sharma. " +
  "You help Indian CA (Foundation/Intermediate/Final) students with clear, accurate, exam-focused explanations. " +
  "Be concise and step-by-step, use Indian accounting/tax/law context, and reference relevant standards or sections where useful. " +
  "If a question is outside the CA syllabus or you are unsure, say so and suggest asking the faculty. " +
  "You assist under CA Parveen Sharma's guidance — never claim to be a human teacher.";

export async function answerDoubt(question: string, context?: string): Promise<string | null> {
  const user = (context ? `Topic context: ${context}\n\n` : "") + `Student's doubt: ${question}`;
  return callClaude(ASSISTANT_SYSTEM, user, 1024);
}

export async function gradeSubjective(
  prompt: string,
  answer: string,
  maxMarks: number | null,
): Promise<{ score: number | null; feedback: string } | null> {
  const mm = maxMarks ?? 10;
  const system =
    `You are an ICAI subject examiner for 1:1 CA Classes. Evaluate the student's answer fairly, the way a CA exam examiner would, out of ${mm} marks. ` +
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
