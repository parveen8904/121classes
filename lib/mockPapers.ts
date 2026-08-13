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
  // He checked the first set against the real paper: Q1 at 20 marks and 2–6 at
  // 20 each made the "70-mark" half worth 130. The ICAI shape is six questions
  // of FOURTEEN, answer five — these exact splits, not approximately.
  "PART II — DESCRIPTIVE (70 MARKS). SIX questions of 14 MARKS EACH. The candidate answers Question 1 (compulsory) " +
  "and ANY FOUR of Questions 2 to 6 — five answered × 14 = 70. The internal split of each question is fixed:\n" +
  "  Question 1 (compulsory): three parts — (a) 5 marks, (b) 5 marks, (c) 4 marks.\n" +
  "  Question 2: 14 marks (one sum, or parts summing to 14).\n" +
  "  Question 3: 14 marks (one sum, or parts summing to 14).\n" +
  "  Question 4: two parts — (a) 7 marks, (b) 7 marks.\n" +
  "  Question 5: two parts — (a) 7 marks, (b) 7 marks.\n" +
  "  Question 6: (a) 4 marks WITH AN INTERNAL CHOICE (write 'OR' between the two alternatives), (b) 5 marks, (c) 5 marks.\n" +
  "No question may carry any other marks. Mix the content as ICAI does: preparation of financial statements or a company " +
  "account, an Accounting Standard application problem, a consolidation or amalgamation sum, a branch or departmental sum, " +
  "and one theory/short-note question citing the standard.\n" +

  "NO TOPIC NAMES — never head or open a question with the name of its chapter, topic or standard " +
  "('Question 2 — Amalgamation' gives the answer away). The real paper does not tell the student which chapter a " +
  "question is from, and neither may this one. A standard may be cited only where the question itself requires it " +
  "('in accordance with AS 19' inside the facts is fine; a topic title is not).\n" +

  "QUESTIONS ONLY — this paper contains NO answers, NO solutions, NO workings, NO hints and NO marking guidance of any " +
  "kind. The last line of your output is 'END OF QUESTION PAPER' and nothing follows it. The suggested answers are " +
  "written separately and are never part of the question paper.\n" +

  "SOURCE — build from the PATTERN of past ICAI exam questions in this subject: the same topics, the same weighting, the same " +
  "style of wording. Do NOT reproduce a past question verbatim; change the companies, the dates and every figure. A student who " +
  "has already seen the original must still have to work.\n" +

  // Paper 1 came back 45% longer than the other two for the same 100 marks —
  // 1,095 lines against 751 and 723. A three-hour paper a student cannot finish
  // in three hours is not a mock of anything.
  "LENGTH — this is a THREE HOUR paper and it must be sittable in three hours. Aim for about 700 lines in total and " +
  "do not exceed 800. Each case scenario is 12-18 lines of situation before its questions, not a page. A descriptive " +
  "question is the data needed and nothing more: no background narrative, no restating of the standard, no explaining " +
  "what the student is being asked to demonstrate. Give the figures and ask for the answer.\n" +

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

/**
 * Draft ONE mock paper, in TWO passes.
 *
 * The first version did both calls in one request and could never finish: the
 * question paper alone took three and a half minutes and came back at exactly
 * 12,000 output tokens — the ceiling, so it was truncated — and the answers to
 * it would have taken as long again. A serverless request stops at five
 * minutes, so the function was killed mid-way, every time, leaving the row
 * stuck on "drafting" where nothing would ever pick it up again.
 *
 * So: one pass writes the QUESTIONS and stops. The next pass writes the ANSWERS
 * to those questions. Each has the whole budget to itself, and a paper that
 * fails halfway keeps the half it finished.
 */
export async function draftMockPaper(id: string): Promise<{ ok: boolean; stage?: string; error?: string }> {
  const svc = createServiceClient();
  const { data: row } = await svc.from("mock_papers").select("*").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "not found" };

  // A call that is killed by the platform still costs money and writes no usage
  // row, so a stage that keeps dying is invisible spend — it ran for two hours
  // before the founder noticed the bill. Count the attempts and stop.
  const tries = Number((row as { attempts?: number }).attempts) || 0;
  if (tries >= 4) {
    await svc
      .from("mock_papers")
      .update({ status: "halted", error: "stopped after 4 failed attempts — nothing more will be spent on it" })
      .eq("id", id);
    return { ok: false, error: "too many attempts" };
  }
  await svc.from("mock_papers").update({ attempts: tries + 1 }).eq("id", id);

  await svc.from("mock_papers").update({ status: "drafting", error: null, updated_at: new Date().toISOString() }).eq("id", id);

  // What is actually taught, so the paper stays inside the syllabus as he
  // teaches it rather than the whole of ICAI's.
  const material = await getRepositoryContext(null, 10000, { query: `${row.subject} ${row.course} exam questions` });

  const ask =
    `Set mock paper number ${row.paper_no} for ${row.course} — ${row.subject}, for the ${row.attempt_label} attempt.\n` +
    `It must differ substantially from the other papers in this set: different topics leading, different companies, different figures.\n\n` +
    `TOPICS ACTUALLY TAUGHT IN THIS COURSE (set the paper from these):\n${material.slice(0, 10000)}`;

  // Likewise the question paper: if he uploaded one, that IS the paper. This
  // was protected only as a side effect of questions_md being filled in from
  // the PDF's text — clear that text for any reason and the AI would have set
  // its own paper over his.
  const existing = row.paper_pdf_url
    ? String(row.questions_md ?? "").trim() || "(his uploaded question paper)"
    : String(row.questions_md ?? "").trim();

  if (!existing) {
    // 20,000, not 12,000: the first attempt stopped at exactly its ceiling,
    // which is what a truncated paper looks like from the outside.
    let questions = await callLong(PAPER_SYSTEM, ask, 20000);
    if (!questions) {
      await svc.from("mock_papers").update({ status: "failed", error: "the question paper came back empty" }).eq("id", id);
      return { ok: false, error: "no questions" };
    }
    // The first set of papers carried worked solutions AFTER the last question —
    // the model kept writing, and the student-facing PDF renders questions_md
    // whole, so the suggested answers leaked into the question paper. The prompt
    // now forbids it; this makes the prompt unnecessary: everything past the
    // end-of-paper line is cut regardless of what the model did.
    const endAt = questions.search(/END OF (QUESTION )?PAPER/i);
    if (endAt >= 0) {
      const lineEnd = questions.indexOf("\n", endAt);
      questions = questions.slice(0, lineEnd < 0 ? undefined : lineEnd).trimEnd();
    }
    await svc
      .from("mock_papers")
      .update({ questions_md: questions, status: "questions_ready", error: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    return { ok: true, stage: "questions" };
  }

  const questions = existing;

  // HIS OWN KEY IS THE KEY. THE AI DOES NOT TOUCH IT.
  //
  // Mock paper 1 had his question paper AND his answer key uploaded as PDFs,
  // and the drafter wrote its own answers over the top of them anyway. The only
  // thing that had been stopping it was answers_progress = 100, a sentinel set
  // at upload time — and any redraft resets that counter, after which the AI
  // appends its own Part I to a key he had written himself. Papers 2 and 3
  // survived only because they had been approved, which the cron happens to
  // skip.
  //
  // A number that means "leave this alone" is the wrong way to say it. The
  // presence of his file says it, cannot be reset by anything, and is checked
  // here where the writing actually happens rather than in the queue that feeds
  // it.
  if (row.answers_pdf_url) {
    await svc
      .from("mock_papers")
      .update({ status: "drafted", answers_progress: 100, error: null, updated_at: new Date().toISOString() })
      .eq("id", id);
    return { ok: true, stage: "his own answer key — nothing drafted" };
  }

  // The answers go in THREE parts, appended in order.
  //
  // A full set of suggested answers to a 100-mark paper is more output than a
  // 300-second request can generate. Every attempt at it in one call was killed
  // before writing anything — and a killed call is still billed, so it cost
  // money and produced nothing, repeatedly. Each part below is small enough to
  // finish, and what is finished is saved.
  const progress = Number(row.answers_progress) || 0;
  const PARTS: { scope: string; tokens: number }[] = [
    { scope: "PART I only — every case-scenario MCQ: the correct option and a one-line reason for each.", tokens: 6000 },
    { scope: "PART II, QUESTIONS 1 TO 3 ONLY — the complete worked answers. Do not answer any other question.", tokens: 14000 },
    { scope: "PART II, QUESTIONS 4 TO 6 ONLY — the complete worked answers. Do not answer any other question.", tokens: 14000 },
  ];
  const part = PARTS[progress];
  if (!part) {
    await svc.from("mock_papers").update({ status: "drafted", error: null, updated_at: new Date().toISOString() }).eq("id", id);
    return { ok: true, stage: "complete" };
  }

  const chunk = await callLong(
    ANSWER_SYSTEM,
    `Below is the mock paper. Write the suggested answers for ${part.scope}\n\n` +
      `Write ONLY that part. Do not repeat the question text, do not write a preamble, and do not summarise — ` +
      `start straight at the first answer.\n\nTHE PAPER:\n${questions}`,
    part.tokens,
  );

  if (!chunk) {
    await svc
      .from("mock_papers")
      .update({ status: "questions_ready", error: `part ${progress + 1} of the answers came back empty — will try again` })
      .eq("id", id);
    return { ok: false, error: `answers part ${progress + 1} empty` };
  }

  const joined = [String(row.answers_md ?? "").trimEnd(), chunk.trim()].filter(Boolean).join("\n\n");
  const done = progress + 1 >= PARTS.length;
  await svc
    .from("mock_papers")
    .update({
      answers_md: joined,
      answers_progress: progress + 1,
      status: done ? "drafted" : "questions_ready",
      error: null,
      generated_at: done ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  return { ok: true, stage: done ? "complete" : `answers part ${progress + 1}` };
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
