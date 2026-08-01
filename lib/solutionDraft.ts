import { createServiceClient } from "@/lib/supabase/service";
import { draftPaperSolution } from "@/lib/ai";

// AI-drafted answer keys for the descriptive tests that have none.
//
// 13 of them — the MTPs and RTPs for Advanced Accounting and Financial
// Reporting — carry no solution PDF, so the evaluator has nothing to mark a
// student's answer book against. Here the paper's already-extracted text is
// turned into a full worked solution — but a draft is inert until the founder
// approves it. Nothing reaches a student, and nothing grades a paper, on the
// strength of an unapproved draft.
//
// Long papers are drafted in passes: a 40-page RTP exceeds one response, so
// the text is split and the parts are joined in order.

const CHARS_PER_PART = 14000;
const MAX_PARTS = 6;

export type QueueSummary = { queued: number; skipped: number };

// ONLY the descriptive tests students actually sit: MTPs, RTPs and past
// papers. The founder confirmed everything else — ICAI material, question
// banks, notes — already carries its solutions inside the file itself, so
// drafting keys for those would be work nobody asked for and AI spend nobody
// needs. Past papers already have solution PDFs and are filtered out below.
const PAPER_KINDS = ["mtp", "rtp", "past_papers"];

export async function queueMissingSolutions(subjectId?: string | null): Promise<QueueSummary> {
  const svc = createServiceClient();

  // Drop anything queued that is not a descriptive test (or has since been
  // given a real solution file). Approved keys are never touched. This keeps
  // the page honest even if the scope was wider when a row was created.
  const { data: stale } = await svc
    .from("item_solutions")
    .select("id, repository_items!inner(kind, student_visible, solution_url)")
    .neq("status", "approved");
  const staleIds = (stale ?? [])
    .filter((r) => {
      const it = (r as unknown as { repository_items: { kind: string; student_visible: boolean; solution_url: string | null } }).repository_items;
      return (
        !PAPER_KINDS.includes(it.kind) ||
        it.student_visible !== true ||
        Boolean(String(it.solution_url ?? "").trim())
      );
    })
    .map((r) => (r as unknown as { id: string }).id);
  if (staleIds.length) await svc.from("item_solutions").delete().in("id", staleIds);
  let q = svc
    .from("repository_items")
    .select("id, solution_url, content, kind")
    .eq("is_active", true)
    .eq("student_visible", true)
    .in("kind", PAPER_KINDS);
  if (subjectId) q = q.eq("subject_id", subjectId);
  const { data: items } = await q;

  const { data: existing } = await svc.from("item_solutions").select("repo_item_id");
  const already = new Set((existing ?? []).map((r) => String(r.repo_item_id)));

  const rows = (items ?? [])
    .filter((i) => !String(i.solution_url ?? "").trim())      // no official key
    .filter((i) => String(i.content ?? "").trim().length > 400) // the paper was actually read
    .filter((i) => !already.has(String(i.id)))
    .map((i) => ({ repo_item_id: i.id as string, status: "queued" }));

  if (!rows.length) return { queued: 0, skipped: (items ?? []).length };
  const { data: ins } = await svc.from("item_solutions").insert(rows).select("id");
  return { queued: ins?.length ?? 0, skipped: (items ?? []).length - rows.length };
}

/** Draft ONE queued paper. Called in small batches from the cron so a long
 * queue never blocks a request or spikes the AI bill. */
export async function draftNextSolution(): Promise<{ done: boolean; title?: string; error?: string }> {
  const svc = createServiceClient();
  const { data: next } = await svc
    .from("item_solutions")
    .select("id, repo_item_id")
    .eq("status", "queued")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!next) return { done: false };

  await svc.from("item_solutions").update({ status: "drafting" }).eq("id", next.id);

  const { data: item } = await svc
    .from("repository_items")
    .select("id, title, content, subjects(title)")
    .eq("id", next.repo_item_id)
    .maybeSingle();

  const content = String(item?.content ?? "").trim();
  const title = String(item?.title ?? "Paper");
  const subject = String((item?.subjects as { title?: string } | null)?.title ?? "");

  if (!content) {
    await svc.from("item_solutions").update({ status: "failed", error: "the paper has no extracted text" }).eq("id", next.id);
    return { done: true, title, error: "no text" };
  }

  const parts: string[] = [];
  for (let i = 0; i < content.length && parts.length < MAX_PARTS; i += CHARS_PER_PART) {
    parts.push(content.slice(i, i + CHARS_PER_PART));
  }

  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const piece = await draftPaperSolution({
      paperTitle: title,
      subject,
      questionText: parts[i],
      part: i + 1,
      totalParts: parts.length,
    });
    if (!piece) {
      await svc
        .from("item_solutions")
        .update({ status: "failed", error: `AI returned nothing for part ${i + 1}` })
        .eq("id", next.id);
      return { done: true, title, error: "AI unavailable" };
    }
    out.push(piece);
  }

  await svc
    .from("item_solutions")
    .update({
      status: "drafted",
      solution_md: out.join("\n\n"),
      parts: parts.length,
      generated_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", next.id);

  return { done: true, title };
}

/** The approved answer key for a paper — the ONLY solution text the portal
 * and the evaluator are allowed to use. */
export async function approvedSolution(repoItemId: string): Promise<string | null> {
  const { data } = await createServiceClient()
    .from("item_solutions")
    .select("solution_md, status")
    .eq("repo_item_id", repoItemId)
    .maybeSingle();
  if (!data || data.status !== "approved") return null;
  const t = String(data.solution_md ?? "").trim();
  return t || null;
}
