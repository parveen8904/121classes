import { createServiceClient } from "@/lib/supabase/service";
import { parseCaseStudiesChunk, explainCaseAnswers } from "@/lib/ai";

// Driver for the case-study engine. A 150-page PDF can't be parsed in one AI
// call, so the source text is consumed in ~15k-char chunks; the AI returns only
// COMPLETE cases plus how far it read, and we resume from there. Progress is
// persisted per chunk (parse_cursor), so processing survives restarts and can
// be continued by the API route, the admin button, or the hourly cron.

// Smaller chunks keep each AI response well under the output-token limit — a
// 15k chunk asked the model to echo several full cases as JSON and overflowed,
// producing truncated (invalid) JSON. ~7k yields 1–2 cases per call safely.
const CHUNK = 7_000;

export async function processCaseSet(setId: string, budgetMs: number): Promise<{ done: boolean; added: number }> {
  const svc = createServiceClient();
  const t0 = Date.now();
  let added = 0;
  for (;;) {
    const { data: set } = await svc
      .from("case_sets")
      .select("id, status, parse_cursor, source_text, skipped_ranges")
      .eq("id", setId)
      .maybeSingle();
    if (!set || set.status !== "processing") return { done: true, added };
    const text = String(set.source_text ?? "");
    let cursor = Number(set.parse_cursor) || 0;
    if (cursor >= text.length) {
      await svc.from("case_sets").update({ status: "ready", status_note: null }).eq("id", setId);
      return { done: true, added };
    }
    // Stop before the serverless clock runs out; the next trigger continues.
    if (Date.now() - t0 > budgetMs) return { done: false, added };

    // Try the full chunk; if it won't parse, retry progressively SMALLER slices
    // (a stubborn chunk usually parses when shorter). Distinguish a real AI
    // outage (retry later, keep the cursor) from unreadable content (skip past).
    let parsed: Awaited<ReturnType<typeof parseCaseStudiesChunk>> = null;
    let aiDown = false;
    for (const size of [CHUNK, Math.floor(CHUNK / 2), 3000, 1500]) {
      const isLast = cursor + size >= text.length;
      const r = await parseCaseStudiesChunk(text.slice(cursor, cursor + size), isLast);
      if (r === "AI_DOWN") { aiDown = true; break; }
      if (r) { parsed = r; break; }
      // r === null → unparseable at this size; shrink and try again.
    }
    if (aiDown) {
      // The model is unavailable right now — stop WITHOUT losing our place.
      await svc.from("case_sets").update({ status_note: "AI temporarily unavailable — will resume automatically" }).eq("id", setId);
      return { done: false, added };
    }
    if (!parsed) {
      // Even a small slice won't parse → skip past this unreadable stretch so
      // the REST of the booklet still processes (never stall forever). RECORD
      // the skipped range + a text preview so the admin can see & recover it.
      const from = cursor;
      cursor = Math.min(cursor + 2500, text.length);
      const preview = text.slice(from, from + 400).replace(/\s+/g, " ").trim();
      const prevRanges = Array.isArray(set.skipped_ranges) ? set.skipped_ranges : [];
      await svc.from("case_sets").update({
        parse_cursor: cursor,
        skipped_ranges: [...prevRanges, { from, to: cursor, at_pct: Math.round((from / text.length) * 100), preview }],
        status_note: `skipped an unreadable section (~${Math.round((cursor / text.length) * 100)}%) — continuing`,
        ...(cursor >= text.length ? { status: "ready" } : {}),
      }).eq("id", setId);
      if (cursor >= text.length) return { done: true, added };
      continue;
    }
    const { count } = await svc.from("case_studies").select("id", { count: "exact", head: true }).eq("set_id", setId);
    let seq = (count ?? 0) + 1;
    for (const c of parsed.cases) {
      const { data: cs } = await svc
        .from("case_studies")
        .insert({ set_id: setId, seq, title: c.title || `Case ${seq}`, scenario: c.scenario })
        .select("id")
        .single();
      if (cs?.id) {
        await svc.from("case_questions").insert(
          c.questions.map((q, i) => ({
            case_id: cs.id,
            seq: i + 1,
            question: q.question,
            options: q.options,
            correct_index: Math.max(0, q.correct_index), // -1 (missing in PDF) → 0; admin can review
          })),
        );
        added++; seq++;
      }
    }
    // Always make progress: if the model returned no usable consumption, skip
    // half a chunk rather than loop forever on the same text.
    const step = parsed.consumed >= 500 ? parsed.consumed : Math.floor(CHUNK / 2);
    cursor = Math.min(cursor + step, text.length);
    await svc
      .from("case_sets")
      .update({ parse_cursor: cursor, status_note: `parsed ${Math.round((cursor / text.length) * 100)}%`, ...(cursor >= text.length ? { status: "ready" } : {}) })
      .eq("id", setId);
    if (cursor >= text.length) return { done: true, added };
  }
}

// Continue every set still processing (cron safety net / API route).
export async function processPendingCaseSets(budgetMs: number): Promise<{ processed: number; pending: number }> {
  const svc = createServiceClient();
  const t0 = Date.now();
  const { data: sets } = await svc.from("case_sets").select("id").eq("status", "processing").limit(10);
  let processed = 0;
  for (const s of sets ?? []) {
    const left = budgetMs - (Date.now() - t0);
    if (left < 20_000) break;
    const r = await processCaseSet(s.id as string, left);
    processed += r.added;
  }
  const { count } = await svc.from("case_sets").select("id", { count: "exact", head: true }).eq("status", "processing");
  return { processed, pending: count ?? 0 };
}

// Make sure every question of a case has its AI explanation (why the correct
// option is right, why each option is right/wrong). One AI call per case,
// cached in the DB forever — so only the FIRST student to finish a case pays.
export async function ensureCaseExplanations(caseId: string): Promise<void> {
  const svc = createServiceClient();
  const [{ data: cs }, { data: qs }] = await Promise.all([
    svc.from("case_studies").select("scenario").eq("id", caseId).maybeSingle(),
    svc.from("case_questions").select("id, question, options, correct_index, explanation").eq("case_id", caseId).order("seq"),
  ]);
  const list = (qs ?? []) as { id: string; question: string; options: string[]; correct_index: number; explanation: unknown }[];
  if (!cs || list.length === 0 || list.every((q) => q.explanation)) return;
  const ex = await explainCaseAnswers(
    String(cs.scenario ?? ""),
    list.map((q) => ({ question: q.question, options: q.options, correct_index: q.correct_index })),
  );
  if (!ex) return;
  await Promise.all(
    list.map((q, i) => (ex[i] ? svc.from("case_questions").update({ explanation: ex[i] }).eq("id", q.id) : null)),
  );
}
