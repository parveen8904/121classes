"use server";

import { createClient } from "@/lib/supabase/server";
import { interviewReply, improveSummary, aiConfigured } from "@/lib/ai";

// Scripted question bank — the interview must NEVER fail to proceed (Apple
// rejected v1.0 over an error here). If the AI is off or errors, we fall back
// to practice mode: solid standard questions, with an honest note that AI
// feedback is paused.
const PRACTICE_QUESTIONS = [
  "Tell me about yourself, and why you chose Chartered Accountancy.",
  "Walk me through the difference between provisions and contingent liabilities, with an example.",
  "A client's revenue jumped 40% but cash from operations fell. What would you look at first?",
  "What is deferred tax, and when does a deferred tax asset arise?",
  "Tell me about a time you handled pressure — an exam, a deadline, anything real.",
  "How would you explain depreciation to someone with no accounting background?",
  "Which accounting standard do you find most interesting, and why?",
  "Where do you see yourself five years after qualifying?",
];
const PRACTICE_CLOSING =
  "That's the end of this practice round — well done for completing it. 👏\n\n" +
  "Self-review checklist: Did you answer in a structure (point → reason → example)? Did you keep technical answers under two minutes? Did any question make you freeze? That's the chapter to revise.\n\n" +
  "This session ran in practice mode (AI feedback is paused right now) — try again later for question-by-question AI assessment.";

function practiceReply(transcript: string): string {
  if (/END INTERVIEW\s*$/.test(transcript)) return PRACTICE_CLOSING;
  const asked = (transcript.match(/Interviewer:/g) ?? []).length;
  if (asked === 0) {
    return "Welcome! I'll be your interviewer today — we'll cover technical, practical and HR questions, one at a time. Take your time with each answer.\n\nFirst question: " + PRACTICE_QUESTIONS[0];
  }
  const q = PRACTICE_QUESTIONS[Math.min(asked, PRACTICE_QUESTIONS.length - 1)];
  return "Noted. Next question: " + q;
}

export async function mockInterview(transcript: string): Promise<{ ok: boolean; text: string; practice?: boolean }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, text: "Please log in to practise the interview." };

  const clipped = transcript.slice(0, 8000);
  if (await aiConfigured()) {
    // Two attempts — a transient API hiccup shouldn't break the interview.
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await interviewReply(clipped);
      if (text) return { ok: true, text };
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  // AI off (admin toggle) or unavailable → seamless scripted practice mode.
  return { ok: true, text: practiceReply(clipped), practice: true };
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
