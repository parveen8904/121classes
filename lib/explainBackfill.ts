import { createServiceClient } from "@/lib/supabase/service";
import { explainCaseAnswers } from "@/lib/ai";
import { saveMcqExplanation } from "@/lib/answers";

// Backfill for answer explanations that were never generated.
//
// Every MCQ and case question already carries the CORRECT answer — what is
// missing on some is the "why". Explanations are generated once and stored
// forever (MCQ: site_settings mcqx:<id>; case: case_questions.explanation), so
// this runs until the backlog is clear and then costs nothing.

type McqRow = { id: string; question: string; options: string[]; correct_index: number };

/** MCQs with no stored explanation yet. */
export async function missingMcqExplanations(): Promise<number> {
  const svc = createServiceClient();
  const { data: keys } = await svc.from("site_settings").select("key").like("key", "mcqx:%");
  const have = new Set((keys ?? []).map((k) => String(k.key).slice(5)));
  const { data: qs } = await svc.from("mcq_questions").select("id");
  return (qs ?? []).filter((q) => !have.has(String(q.id))).length;
}

/** Explain one batch of MCQs. Returns how many were written. */
export async function backfillMcqExplanations(limit = 20): Promise<number> {
  const svc = createServiceClient();
  const { data: keys } = await svc.from("site_settings").select("key").like("key", "mcqx:%");
  const have = new Set((keys ?? []).map((k) => String(k.key).slice(5)));

  const { data: qs } = await svc
    .from("mcq_questions")
    .select("id, question, options, correct_index, section_id")
    .limit(2000);
  const todo = ((qs ?? []) as unknown as (McqRow & { section_id: string })[])
    .filter((q) => !have.has(String(q.id)))
    .slice(0, limit);
  if (!todo.length) return 0;

  // Reuse the case-study explainer: it takes questions with options and a
  // correct index, which is exactly the shape of an MCQ.
  const out = await explainCaseAnswers(
    "Standalone chapter MCQs from CA Parveen Sharma's tests.",
    todo.map((q) => ({
      question: q.question,
      options: (q.options ?? []).map((o) => String(o)),
      correct_index: Number(q.correct_index) || 0,
    })),
  );
  if (!out) return 0;

  let written = 0;
  for (let i = 0; i < todo.length && i < out.length; i++) {
    const e = out[i];
    if (!e?.why_correct) continue;
    await saveMcqExplanation(todo[i].id, e.why_correct, e.why_options ?? []);
    written++;
  }
  return written;
}

/** Case-study questions whose explanation column is still empty. */
export async function backfillCaseExplanations(limit = 20): Promise<number> {
  const svc = createServiceClient();
  const { data: rows } = await svc
    .from("case_questions")
    .select("id, case_id, question, options, correct_index")
    .is("explanation", null)
    .order("case_id")
    .limit(limit);
  const list = (rows ?? []) as unknown as (McqRow & { case_id: string })[];
  if (!list.length) return 0;

  // Group by case so each batch shares its scenario — the explanation is only
  // right if it is read against the scenario the question belongs to.
  const byCase = new Map<string, typeof list>();
  for (const r of list) {
    if (!byCase.has(r.case_id)) byCase.set(r.case_id, [] as unknown as typeof list);
    byCase.get(r.case_id)!.push(r);
  }

  let written = 0;
  for (const [caseId, qs] of byCase) {
    const { data: cs } = await svc.from("case_studies").select("scenario").eq("id", caseId).maybeSingle();
    const scenario = String((cs as { scenario?: string } | null)?.scenario ?? "").trim();
    if (!scenario) continue;
    const out = await explainCaseAnswers(
      scenario,
      qs.map((q) => ({
        question: q.question,
        options: (q.options ?? []).map((o) => String(o)),
        correct_index: Number(q.correct_index) || 0,
      })),
    );
    if (!out) continue;
    for (let i = 0; i < qs.length && i < out.length; i++) {
      const e = out[i];
      if (!e?.why_correct) continue;
      await svc
        .from("case_questions")
        .update({ explanation: { wc: e.why_correct, ww: e.why_options ?? [] } })
        .eq("id", qs[i].id);
      written++;
    }
  }
  return written;
}
