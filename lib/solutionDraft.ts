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
    .not("repo_item_id", "is", null)
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
// The DESCRIPTIVE TESTS with no answer key — the ones the founder actually
// meant. These live in `sections`, not `repository_items`, which is why they
// were never queued: 37 published tests with a question paper and no solution
// PDF, so a student's answer book has nothing to be marked against.
export async function queueMissingSectionSolutions(): Promise<QueueSummary> {
  const svc = createServiceClient();

  const { data: rows } = await svc
    .from("sections")
    .select("id, m_paper_question_pdf, m_paper_solution_pdf")
    .eq("is_published", true)
    .not("m_paper_question_pdf", "is", null)
    .limit(2000);

  type Row = { id: string; m_paper_question_pdf: string | null; m_paper_solution_pdf: string | null };
  const needing = ((rows as Row[]) ?? []).filter(
    (r) => String(r.m_paper_question_pdf ?? "").trim() && !String(r.m_paper_solution_pdf ?? "").trim(),
  );

  const { data: existing } = await svc.from("item_solutions").select("section_id").not("section_id", "is", null);
  const already = new Set((existing ?? []).map((r) => String(r.section_id)));

  // A test that has since been given a real solution PDF drops out of the
  // queue, unless its draft is already approved.
  const withKey = ((rows as Row[]) ?? [])
    .filter((r) => String(r.m_paper_solution_pdf ?? "").trim())
    .map((r) => r.id);
  if (withKey.length) {
    await svc.from("item_solutions").delete().in("section_id", withKey).neq("status", "approved");
  }

  const fresh = needing.filter((r) => !already.has(r.id)).map((r) => ({ section_id: r.id, status: "queued" }));
  if (!fresh.length) return { queued: 0, skipped: needing.length };
  const { data: ins } = await svc.from("item_solutions").insert(fresh).select("id");
  return { queued: ins?.length ?? 0, skipped: needing.length - fresh.length };
}

// Reclaim descriptive tests left mid-flight. A row is flipped to "drafting"
// before its (slow) AI call starts, so when a press runs out of time the row
// it was working on stays claimed for ever. Every pass frees them first.
async function reclaimStuckSections(svc: ReturnType<typeof createServiceClient>) {
  await svc
    .from("item_solutions")
    .update({ status: "queued", claimed_at: null })
    .eq("status", "drafting")
    .not("section_id", "is", null)
    .lt("claimed_at", new Date(Date.now() - 10 * 60_000).toISOString());
}

async function draftOneSection(
  svc: ReturnType<typeof createServiceClient>,
  row: { id: string; section_id: string },
): Promise<{ title: string; error?: string }> {
  const { data: sec } = await svc
    .from("sections")
    .select("id, title, question_pdf:config->>paper_question_pdf, marks:config->>paper_total_marks, topics(subjects(title))")
    .eq("id", row.section_id)
    .maybeSingle();

  const title = String(sec?.title ?? "Descriptive test");
  const subject = String(
    ((sec as { topics?: { subjects?: { title?: string } | null } | null } | null)?.topics?.subjects?.title) ?? "",
  );
  const ref = String((sec as { question_pdf?: string } | null)?.question_pdf ?? "");
  if (!ref) {
    await svc.from("item_solutions").update({ status: "failed", error: "no question paper on this test" }).eq("id", row.id);
    return { title, error: "no question paper" };
  }

  const { resolveFileUrl } = await import("@/lib/storage");
  const url = await resolveFileUrl(ref, 900);
  if (!url) {
    await svc.from("item_solutions").update({ status: "failed", error: "could not open the question paper" }).eq("id", row.id);
    return { title, error: "cannot open paper" };
  }

  const { draftSolutionFromPdf } = await import("@/lib/ai");
  const text = await draftSolutionFromPdf({
    paperTitle: title,
    subject,
    questionPdfUrl: url,
    totalMarks: Number((sec as { marks?: string } | null)?.marks) || null,
  });

  if (!text) {
    await svc.from("item_solutions").update({ status: "failed", error: "the AI returned nothing for this paper" }).eq("id", row.id);
    return { title, error: "AI returned nothing" };
  }

  await svc
    .from("item_solutions")
    .update({ solution_md: text, status: "drafted", parts: 1, generated_at: new Date().toISOString() })
    .eq("id", row.id);
  return { title };
}

/**
 * Draft several descriptive tests AT ONCE.
 *
 * One paper is a single long AI call — around a minute and a half — so drafting
 * them one after another managed barely two per press and 37 would have taken
 * the best part of twenty presses. The calls are independent, so they run
 * together instead.
 */
export async function draftSectionSolutionsBatch(
  concurrency = 5,
  budgetMs = 240_000,
): Promise<{ drafted: string[]; failed: string[]; remaining: number }> {
  const svc = createServiceClient();
  await reclaimStuckSections(svc);

  const drafted: string[] = [];
  const failed: string[] = [];
  const started = Date.now();

  // Never claim a paper we cannot finish — that is what left a stranded row
  // behind on every press. One paper needs roughly 100 seconds.
  const ONE_PAPER_MS = 110_000;

  while (Date.now() - started + ONE_PAPER_MS < budgetMs) {
    const { data: batch } = await svc
      .from("item_solutions")
      .select("id, section_id")
      .eq("status", "queued")
      .not("section_id", "is", null)
      .order("created_at")
      .limit(concurrency);

    const rows = (batch ?? []) as { id: string; section_id: string }[];
    if (!rows.length) break;

    await svc
      .from("item_solutions")
      .update({ status: "drafting", claimed_at: new Date().toISOString() })
      .in("id", rows.map((r) => r.id));

    const results = await Promise.all(
      rows.map((r) =>
        draftOneSection(svc, r).catch((e) => ({
          title: "Descriptive test",
          error: e instanceof Error ? e.message : "failed",
        })),
      ),
    );
    for (const r of results) {
      if (r.error) failed.push(`${r.title}: ${r.error}`);
      else drafted.push(r.title);
    }
  }

  const { count } = await svc
    .from("item_solutions")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .not("section_id", "is", null);

  return { drafted, failed, remaining: count ?? 0 };
}

export async function draftNextSolution(): Promise<{ done: boolean; title?: string; error?: string }> {
  const svc = createServiceClient();

  // Reclaim stale locks first. A row is flipped to "drafting" before the AI
  // calls start, so if that pass is cut short (platform timeout, deploy mid-run)
  // the row stays "drafting" for ever and its paper is never drafted again —
  // six were sitting like that. Anything still claimed after 30 minutes is
  // certainly dead, so put it back in the queue.
  await svc
    .from("item_solutions")
    .update({ status: "queued", claimed_at: null })
    .eq("status", "drafting")
    .lt("claimed_at", new Date(Date.now() - 30 * 60_000).toISOString());

  const { data: next } = await svc
    .from("item_solutions")
    .select("id, repo_item_id")
    .eq("status", "queued")
    .not("repo_item_id", "is", null)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!next) return { done: false };

  await svc
    .from("item_solutions")
    .update({ status: "drafting", claimed_at: new Date().toISOString() })
    .eq("id", next.id);

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
