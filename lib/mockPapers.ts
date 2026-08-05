import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import { NOT_TAUGHT } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";

// Full-length mock exam papers, set the way ICAI sets them.
//
// 100 marks in two halves, because that is the paper a student will actually
// sit in September:
//   Part I  — 30 marks of CASE SCENARIO MCQs (short scenarios, questions
//             hanging off each, 2 marks apiece)
//   Part II — 70 marks descriptive, Q1 compulsory, then a choice
//
// The questions are built from the pattern of past exam questions, not copied
// from them: reproducing an ICAI paper verbatim is somebody else's copyright,
// and a student who has seen the original learns nothing from it. Same topics,
// same weighting, same style, fresh figures.
//
// Nothing here reaches a student until CA Parveen Sharma approves it. That is
// the same rule as the answer keys, and for the same reason: his name is on it.

const PAPER_SYSTEM =
  "You are CA Parveen Sharma setting a MOCK EXAMINATION PAPER for Indian CA students, in ICAI's own examination pattern. " +
  "You have taught this subject for 36 years and you are setting the paper a student will sit before the real exam.\n" +

  "PATTERN — follow it exactly:\n" +
  "PART I — CASE SCENARIO BASED MCQs (30 MARKS). Two or three short case scenarios, each a realistic company situation with figures. " +
  "Under each scenario, MCQs of 2 marks each, four options apiece, until Part I totals exactly 30 marks (15 questions). " +
  "The options must be genuinely close — the wrong ones should be the mistakes a student actually makes, not obvious nonsense.\n" +
  "PART II — DESCRIPTIVE (70 MARKS). Question 1 is COMPULSORY and carries 20 marks (two or three parts). " +
  "Then Questions 2 to 6, of which the student answers ANY FOUR, each carrying up to 20 marks in parts, adding to 70 with Q1. " +
  "Mix them as ICAI does: preparation of financial statements or a company account, an Accounting Standard application problem, " +
  "a consolidation or amalgamation sum, a branch or departmental sum, and one theory/short-note question citing the standard.\n" +

  "SOURCE — build from the PATTERN of past ICAI exam questions in this subject: the same topics, the same weighting, the same " +
  "style of wording. Do NOT reproduce a past question verbatim; change the companies, the dates and every figure. A student who " +
  "has already seen the original must still have to work.\n" +

  "ARITHMETIC — every sum must be internally consistent and actually solvable from the data given. Balance what should balance. " +
  "State the assumptions an examiner would accept. If a figure is needed to solve it, put it in the question.\n" +

  NOT_TAUGHT +

  "LAYOUT — plain text only, no markdown, no asterisks, no tables. Head it exactly as ICAI does: the paper title, " +
  "'Time Allowed: 3 Hours' and 'Maximum Marks: 100' on their own lines, then the instructions to candidates, then PART I. " +
  "Put the marks for each question in brackets at the right of its last line. Use 'Rs.' not the rupee symbol and Indian digit " +
  "grouping (1,25,000 not 125,000). Keep every line within 96 characters so nothing wraps when it is printed.";

const ANSWER_SYSTEM =
  "You are CA Parveen Sharma writing the SUGGESTED ANSWERS to your own mock paper, exactly as ICAI publishes them.\n" +
  "For Part I give the correct option for each MCQ with a one-line reason.\n" +
  "For Part II give the complete worked answer a student could reproduce to score full marks: every working note labelled, " +
  "every journal entry, every ledger account and every statement in full, and the standard or section cited for theory.\n" +
  "Present every LEDGER ACCOUNT as a two-sided account: a title line with 'Dr.' at the left and 'Cr.' at the right, " +
  "'Particulars' and 'Amount (Rs.)' headings on each side, entries paired across the page, a rule of dashes above the totals, " +
  "and the two totals level on the same line. Statements and working notes are labelled columns of figures, right-aligned, " +
  "with a dashes rule before a total.\n" +
  "Work through the figures ONCE and stay consistent — never show a figure, then a contradiction, then a revised check. " +
  "If the data genuinely does not reconcile, say so in one sentence, state the assumption you adopt, and carry it through.\n" +
  NOT_TAUGHT +
  "Plain text only — no markdown, no asterisks, no tables. 'Rs.' not the rupee symbol, Indian digit grouping, " +
  "every line within 96 characters.";

async function callLong(system: string, user: string, maxTokens: number): Promise<string | null> {
  const apiKey = await getSecret("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  const model = (await getSecret("ANTHROPIC_MODEL")) || "claude-sonnet-4-6";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.3, system, messages: [{ role: "user", content: user }] }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[mock_paper] refused", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    const u = data.usage ?? {};
    // Recorded on the same ledger as every other AI call, so a mock paper
    // shows up in the cost readout rather than being invisible spend.
    try {
      const inTok = Number(u.input_tokens) || 0;
      const outTok = Number(u.output_tokens) || 0;
      await createServiceClient().from("ai_usage").insert({
        feature: "mock_paper",
        model,
        input_tokens: inTok,
        output_tokens: outTok,
        cost_usd: Number(((inTok / 1e6) * 3 + (outTok / 1e6) * 15).toFixed(5)),
      });
    } catch { /* never let bookkeeping break the paper */ }
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();
    return text || null;
  } catch (e) {
    console.error("[mock_paper] call failed", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Draft ONE mock paper: the questions, then the answers to those questions. */
export async function draftMockPaper(id: string): Promise<{ ok: boolean; error?: string }> {
  const svc = createServiceClient();
  const { data: row } = await svc.from("mock_papers").select("*").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "not found" };

  await svc.from("mock_papers").update({ status: "drafting", error: null, updated_at: new Date().toISOString() }).eq("id", id);

  // What is actually taught, so the paper stays inside the syllabus as he
  // teaches it rather than the whole of ICAI's.
  const material = await getRepositoryContext(null, 10000, { query: `${row.subject} ${row.course} exam questions` });

  const ask =
    `Set mock paper number ${row.paper_no} for ${row.course} — ${row.subject}, for the ${row.attempt_label} attempt.\n` +
    `It must differ substantially from the other papers in this set: different topics leading, different companies, different figures.\n\n` +
    `TOPICS ACTUALLY TAUGHT IN THIS COURSE (set the paper from these):\n${material.slice(0, 10000)}`;

  const questions = await callLong(PAPER_SYSTEM, ask, 12000);
  if (!questions) {
    await svc.from("mock_papers").update({ status: "failed", error: "the question paper came back empty" }).eq("id", id);
    return { ok: false, error: "no questions" };
  }

  const answers = await callLong(
    ANSWER_SYSTEM,
    `Write the suggested answers to THIS paper. Answer every question in it, in order.\n\n${questions}`,
    16000,
  );
  if (!answers) {
    await svc
      .from("mock_papers")
      .update({ questions_md: questions, status: "failed", error: "the answers came back empty — the paper is saved, press draft again" })
      .eq("id", id);
    return { ok: false, error: "no answers" };
  }

  await svc
    .from("mock_papers")
    .update({
      questions_md: questions,
      answers_md: answers,
      status: "drafted",
      error: null,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  return { ok: true };
}

/** Create the three September 2026 slots if they are not there yet. */
export async function ensureSeptember2026Set(): Promise<number> {
  const svc = createServiceClient();
  const rows = [1, 2, 3].map((n) => ({
    course: "CA Intermediate",
    subject: "Advanced Accounting",
    attempt_label: "September 2026",
    paper_no: n,
    title: `CA Intermediate — Advanced Accounting — Mock Test Paper ${n} (September 2026)`,
    total_marks: 100,
    duration_min: 180,
    status: "queued",
  }));
  const { data } = await svc.from("mock_papers").upsert(rows, { onConflict: "course,subject,attempt_label,paper_no", ignoreDuplicates: true }).select("id");
  return data?.length ?? 0;
}
