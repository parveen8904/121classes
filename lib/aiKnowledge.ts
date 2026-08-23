import { createServiceClient } from "@/lib/supabase/service";

// WHAT THE FACULTY HAS WRITTEN DOWN, PUT IN FRONT OF THE MODEL WHEN IT APPLIES.
//
// The lessons file next door holds one-line house rules, and is kept small on
// purpose: a wall of half-relevant instructions makes a model worse. This is the
// opposite problem. An exam blueprint or a revision roadmap is long, it is
// authoritative, and a student asking about revision deserves it quoted
// accurately and in full — not paraphrased from memory, and not summarised into
// uselessness.
//
// So the document is stored whole and injected ONLY when the question is about
// it. A student asking how to account for a lease modification does not need the
// revision timetable, and paying to send it to them would be waste.

export type Knowledge = {
  id: string;
  title: string;
  subject: string | null;
  triggers: string[];
  body: string;
  priority: number;
};

const STOP = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "this", "that", "have", "has",
  "was", "were", "will", "can", "could", "would", "should", "what", "when", "where", "which",
  "who", "why", "how", "from", "into", "about", "there", "their", "them", "they", "our", "any",
  "all", "please", "sir", "maam", "madam", "hai", "hey", "hello", "kya", "mein", "koi", "tell",
  "give", "want", "need", "know", "much", "many",
  // Short function words. They are two and three letters, they carry no
  // subject, and left in they do real damage: "Ind AS 116" and "ind as" share
  // "as", which is enough to hang a fifteen-thousand-character exam blueprint
  // on a lease question.
  "is", "in", "of", "on", "at", "to", "or", "by", "be", "do", "if", "so", "no", "up",
  "an", "as", "my", "me", "we", "us", "it", "its", "he", "she", "his", "her", "im",
  "am", "did", "does", "done", "get", "got", "let", "may", "per", "pls", "plz", "ok",
]);

/** A student never asks twice in the same words. Fold to the thing they mean. */
const FAMILY: [RegExp, string][] = [
  [/^(revise|revision|revisions|revising|revised|rivision|revison)$/, "revision"],
  [/^(strategy|strategies|plan|planning|approach|roadmap|schedule|timetable|routine)$/, "strategy"],
  [/^(exam|exams|examination|attempt|attempts|paper|papers)$/, "exam"],
  [/^(pattern|patterns|blueprint|structure|format|weightage|weight|marks|marking)$/, "pattern"],
  [/^(prepare|preparation|preparing|study|studying|studies|crack|clear)$/, "prepare"],
  [/^(fr|financial|reporting)$/, "fr"],
  [/^(final|finals)$/, "final"],
  [/^(mock|mocks|mtp|mtps|test|tests|testing)$/, "mock"],
  [/^(chapter|chapters|topic|topics)$/, "chapter"],
  [/^(amendment|amendments|applicable|applicability|cut-off|cutoff)$/, "amendment"],
  [/^(exclude|excluded|exclusion|exclusions|scope)$/, "exclusion"],
  [/^(answer|answers|writing|presentation|format)$/, "answer"],
  [/^(important|importance|priority|high-yield|yield|scoring)$/, "important"],
];

function canon(w: string): string {
  for (const [re, to] of FAMILY) if (re.test(w)) return to;
  return w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

function words(text: string): Set<string> {
  return new Set(
    (text ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)).map(canon),
  );
}

let cache: { at: number; rows: Knowledge[] } | null = null;

async function all(): Promise<Knowledge[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.rows;
  const svc = createServiceClient();
  const { data } = await svc.from("ai_knowledge")
    .select("id, title, subject, triggers, body, priority")
    .eq("active", true).order("priority", { ascending: false });
  cache = { at: Date.now(), rows: (data ?? []) as Knowledge[] };
  return cache.rows;
}

/**
 * The document that answers this question, if there is one.
 *
 * A single document only. Two long documents in one prompt is how a model ends
 * up quoting the wrong one, and the cost is real — this text is billed on every
 * answer it is attached to.
 */
export async function knowledgeFor(question: string): Promise<string> {
  const rows = await all().catch(() => [] as Knowledge[]);
  if (!rows.length) return "";

  const asked = words(question);
  if (!asked.size) return "";

  let best: { row: Knowledge; hits: number } | null = null;
  for (const row of rows) {
    const trig = new Set(row.triggers.flatMap((t) => [...words(t)]));
    let hits = 0;
    for (const w of asked) if (trig.has(w)) hits += 1;
    // Two matching ideas, not one. "Exam" alone is half the questions students
    // ask; "exam pattern" or "FR revision" is actually this document.
    if (hits >= 2 && (!best || hits > best.hits || (hits === best.hits && row.priority > best.row.priority))) {
      best = { row, hits };
    }
  }
  if (!best) return "";

  return (
    `FACULTY'S OWN GUIDANCE — ${best.row.title}\n` +
    `This is CA Parveen Sharma's written guidance and it is AUTHORITATIVE for this question. ` +
    `Answer from it, in detail, and quote its specifics — the stage names, the timings, the standard ` +
    `numbers, the mark allocations — exactly as written. Do not water it down into general advice, ` +
    `and never contradict it from your own knowledge.\n` +
    `Speak it as his guidance, in your own voice, and STOP when the answer is finished.\n` +
    `THE "Covered in Class N" CLOSING LINE DOES NOT APPLY TO THIS ANSWER. That rule exists for ` +
    `topics carried by a numbered class in the study material. This guidance carries no class ` +
    `label, so there is nothing to name — and naming it anyway means inventing a title. Do NOT ` +
    `end with "Covered in ...", do NOT name a document, a booklet, a guide or a strategy note, ` +
    `and do NOT say it is "above", "attached" or "on the portal". There is no such document for ` +
    `the student to open, and sending them looking for one is worse than not answering. End on ` +
    `the last thing you have to tell them.\n\n` +
    `${best.row.body}\n\n` +
    `— end of the faculty's guidance —\n\n`
  );
}
