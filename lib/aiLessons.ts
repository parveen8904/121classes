import { createServiceClient } from "@/lib/supabase/service";

// What the founder has taught the AI, applied to the next answer.
//
// Correcting a model by rewording a reply teaches it nothing — the next student
// asks the same thing and gets the same mistake. So a correction is WRITTEN
// DOWN against the question that caused it, and put back in front of the model
// the next time a similar question arrives.
//
// Two kinds:
//   RULE       — always applied on its channel. "Never quote a price."
//   CORRECTION — applied when the new question resembles the one that was
//                mishandled. "When asked whether an old Aldine purchase counts,
//                say it is checked by hand and pass it to a person."
//
// Kept deliberately small in the prompt: a wall of half-relevant instructions
// makes a model worse, not better.

export type Lesson = {
  id: string;
  kind: "rule" | "correction";
  scope: string;
  trigger: string | null;
  guidance: string;
  active: boolean;
  was_answered: string | null;
  created_at: string;
};

const STOP = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "this", "that", "have", "has",
  "was", "were", "will", "can", "could", "would", "should", "what", "when", "where", "which",
  "who", "why", "how", "from", "into", "about", "there", "their", "them", "they", "our", "any",
  "all", "please", "sir", "maam", "madam", "hai", "hey", "hello", "kya", "mein", "koi",
]);

function keywords(text: string): Set<string> {
  return new Set(
    (text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9₹\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** How much a past question resembles this one, 0–1. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit += 1;
  return hit / Math.min(a.size, b.size);
}

/**
 * The lessons that apply to this question on this channel.
 * Every active rule, plus the corrections whose original question is close enough.
 */
export async function lessonsFor(question: string, feature: string): Promise<Lesson[]> {
  try {
    const svc = createServiceClient();
    const { data } = await svc
      .from("ai_lessons")
      .select("id, kind, scope, trigger, guidance, active, was_answered, created_at")
      .eq("active", true)
      .in("scope", ["all", feature])
      .order("created_at", { ascending: false })
      .limit(200);

    const all = (data ?? []) as Lesson[];
    const rules = all.filter((l) => l.kind === "rule").slice(0, 25);

    const qk = keywords(question);
    const corrections = all
      .filter((l) => l.kind === "correction" && l.trigger)
      .map((l) => ({ l, score: overlap(keywords(l.trigger!), qk) }))
      // A third of the shorter question's words in common. Low enough to catch a
      // rephrasing, high enough that an unrelated lesson does not crowd out the
      // material.
      .filter((x) => x.score >= 0.34)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.l);

    return [...rules, ...corrections];
  } catch {
    return [];
  }
}

/** The block put in front of the model. Empty string when nothing has been taught. */
export function lessonBlock(lessons: Lesson[]): string {
  if (lessons.length === 0) return "";
  const rules = lessons.filter((l) => l.kind === "rule");
  const corrections = lessons.filter((l) => l.kind === "correction");

  const parts: string[] = [
    "HOUSE RULES FROM CA PARVEEN SHARMA — these OVERRIDE anything else in this prompt,",
    "including the study material. Where they conflict with your own judgement, they win.",
  ];
  if (rules.length) {
    parts.push("", "ALWAYS:");
    for (const r of rules) parts.push(`- ${r.guidance.trim()}`);
  }
  if (corrections.length) {
    parts.push(
      "",
      "HE HAS CORRECTED THIS BEFORE. A question like the one below was answered badly;",
      "answer it his way this time:",
    );
    for (const c of corrections) {
      parts.push(`- When asked: "${(c.trigger ?? "").trim().slice(0, 200)}"`);
      parts.push(`  Answer: ${c.guidance.trim()}`);
    }
  }
  return parts.join("\n");
}

/** Convenience: fetch and format in one call. */
export async function lessonPrefix(question: string, feature: string): Promise<string> {
  const block = lessonBlock(await lessonsFor(question, feature));
  return block ? `${block}\n\n` : "";
}
