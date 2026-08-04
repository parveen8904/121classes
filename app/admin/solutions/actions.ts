"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertArea } from "@/lib/adminAccess";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { queueMissingSectionSolutions, draftSectionSolutionsBatch } from "@/lib/solutionDraft";
import { str } from "../_lib/util";

// Approving is the whole point of this page: a drafted key does nothing until
// CA Parveen Sharma says it is right. Approval is what lets a solution reach a
// student and what lets the evaluator mark against it.

// ONE button, one job: find every descriptive test with no answer key, then
// draft as many as fit in this press. Splitting "queue it" from "draft it"
// across two buttons only made the founder guess which one he needed.
//
// DESCRIPTIVE TESTS ONLY — he deleted the repository MTP/RTP drafts
// deliberately and asked twice for these tests alone.
export async function draftMissingKeys() {
  await assertArea(null);
  const q = await queueMissingSectionSolutions();
  // Five at a time: a paper is one long AI call, so drafting them one after
  // another managed barely two per press.
  const r = await draftSectionSolutionsBatch(5, 235_000);
  revalidatePath("/admin/solutions");
  redirect(
    `/admin/solutions?queued=${q.queued}&drafted=${r.drafted.length}` +
      `&draftfailed=${r.failed.length}&stillqueued=${r.remaining}`,
  );
}

// Draft the waiting ones NOW rather than waiting for tonight's run. Drafting a
// whole paper is a long AI call, so one press takes as many as fit in the time
// available and says how many are left — press again to continue.


export async function approveSolution(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  await createServiceClient()
    .from("item_solutions")
    .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: user?.id ?? null })
    .eq("id", id);
  revalidatePath("/admin/solutions");
}

export async function unapproveSolution(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient()
    .from("item_solutions")
    .update({ status: "drafted", approved_at: null, approved_by: null })
    .eq("id", id);
  revalidatePath("/admin/solutions");
}

/** Edit the wording, then approve in the same click. */
export async function saveSolution(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  const text = str(formData.get("solution_md"));
  if (!id || !text) return;
  const approve = formData.get("approve") === "1";
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  await createServiceClient()
    .from("item_solutions")
    .update({
      solution_md: text,
      edited: true,
      ...(approve
        ? { status: "approved", approved_at: new Date().toISOString(), approved_by: user?.id ?? null }
        : {}),
    })
    .eq("id", id);
  revalidatePath("/admin/solutions");
}

/** The video walkthrough for a paper — students get it beside the written
 * key once they have submitted. Saved independently of approval, so a video
 * can be attached before or after the text is signed off. */
export async function saveSolutionVideo(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  const url = str(formData.get("video_url")).trim();
  if (url && !/^https?:\/\//i.test(url)) return; // a link, or nothing
  await createServiceClient()
    .from("item_solutions")
    .update({ video_url: url || null })
    .eq("id", id);
  revalidatePath("/admin/solutions");
}

/** A failed draft goes back in the queue for another pass. */
export async function retrySolution(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient()
    .from("item_solutions")
    .update({ status: "queued", error: null })
    .eq("id", id);
  revalidatePath("/admin/solutions");
}

// Run the explanation backfill on demand. Every MCQ and case question already
// has its correct answer; what some lack is the "why" shown in the report.
// Bounded to ~45 seconds per press so the request always returns — press it
// again to continue, or leave it to the nightly worker.
// The whole backlog in one press: six batches at a time instead of one after
// another, so 500-odd questions are not twenty presses of a button.
export async function generateExplanations() {
  await assertArea(null);
  const { backfillAllExplanations } = await import("@/lib/explainBackfill");
  const r = await backfillAllExplanations(235_000, 6);
  revalidatePath("/admin/solutions");
  redirect(
    `/admin/solutions?mcq=${r.mcq}&cases=${r.cases}&mcqleft=${r.mcqLeft}&casesleft=${r.casesLeft}`,
  );
}

// Remove a draft entirely. Re-queue the paper afterwards and it is drafted
// again from scratch — so this is the way to throw away a bad draft rather
// than editing around it. Deleting an APPROVED key also removes what the
// evaluator marks that test against, which is why the button says so.
export async function deleteSolution(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("item_solutions").delete().eq("id", id);
  revalidatePath("/admin/solutions");
  redirect("/admin/solutions?removed=1");
}

/**
 * Delete every ticked key in one go — EXCEPT the approved ones.
 *
 * Select-all plus delete wiped 44 approved answer keys in a single press,
 * including five typeset keys that had just replaced scanned student copies.
 * An approved key is the thing a student sees and the thing every paper is
 * marked against; it is not something to lose to a tick box. Removing one is
 * still possible, one at a time, on its own row.
 */
export async function deleteSelectedSolutions(formData: FormData) {
  await assertArea(null);
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) redirect("/admin/solutions?removed=0");

  const svc = createServiceClient();
  const { data: rows } = await svc.from("item_solutions").select("id, status").in("id", ids);
  const deletable = (rows ?? []).filter((r) => r.status !== "approved").map((r) => String(r.id));
  const kept = (rows ?? []).length - deletable.length;

  if (deletable.length) await svc.from("item_solutions").delete().in("id", deletable);
  revalidatePath("/admin/solutions");
  redirect(`/admin/solutions?removed=${deletable.length}&keptapproved=${kept}`);
}

/** Put the ticked ones back in the queue — again, never an approved key. */
export async function requeueSelectedSolutions(formData: FormData) {
  await assertArea(null);
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) redirect("/admin/solutions?requeued=0");
  await createServiceClient()
    .from("item_solutions")
    .update({ status: "queued", solution_md: null, error: null, claimed_at: null })
    .in("id", ids)
    .neq("status", "approved");
  revalidatePath("/admin/solutions");
  redirect(`/admin/solutions?requeued=${ids.length}`);
}

// Attach YOUR OWN answer key as a PDF, instead of using the AI draft.
//
// The page could only ever approve drafted text, so a key that already existed
// as a file had nowhere to go. A test that has a solution PDF is marked against
// that PDF, and the draft is left alone — the file wins, which is the point.
export async function saveSolutionPdf(formData: FormData) {
  await assertArea(null);
  const sectionId = str(formData.get("section_id"));
  const url = str(formData.get("paper_solution_pdf"));
  if (!sectionId) return;

  const svc = createServiceClient();
  const { data: sec } = await svc.from("sections").select("config").eq("id", sectionId).maybeSingle();
  if (!sec) return;

  const cfg = { ...((sec.config ?? {}) as Record<string, unknown>) };
  cfg.paper_solution_pdf = url || null;
  await svc.from("sections").update({ config: cfg }).eq("id", sectionId);

  revalidatePath("/admin/solutions");
  redirect(`/admin/solutions?keypdf=${url ? "1" : "0"}`);
}

// Check every uploaded "official solution" and replace any that is really a
// scanned student copy with a proper typeset key. Runs in passes; press again
// until nothing is left to check.
export async function auditOfficialSolutions() {
  await assertArea(null);
  const { auditSolutionPdfs } = await import("@/lib/solutionAudit");
  const r = await auditSolutionPdfs(6, 230_000);
  revalidatePath("/admin/solutions");
  redirect(
    `/admin/solutions?checked=${r.checked}&typeset=${r.typeset.length}` +
      `&replaced=${r.replaced.length}&auditfailed=${r.failed.length}&auditleft=${r.remaining}`,
  );
}

/**
 * Approve every drafted key at once.
 *
 * 44 approved keys were lost to a single press this evening. Putting them back
 * one row at a time is punishing, so this approves everything currently
 * drafted — read them first; approving is what makes a key real.
 */
export async function approveAllDrafted() {
  await assertArea(null);
  const svc = createServiceClient();
  const { data: rows } = await svc.from("item_solutions").select("id").eq("status", "drafted").limit(500);
  const ids = (rows ?? []).map((r) => String(r.id));
  if (!ids.length) redirect("/admin/solutions?approvedall=0");

  await svc
    .from("item_solutions")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .in("id", ids);

  revalidatePath("/admin/solutions");
  redirect(`/admin/solutions?approvedall=${ids.length}`);
}

// ---- adopting a re-laid-out key ----
//
// The approved keys are being rewritten in ICAI's presentation. The new text
// waits in pending_md; the approved key stays live and stays what papers are
// marked against until it is adopted here. Nothing a student reads changes on
// a machine's say-so.

/** Run the re-layout NOW rather than waiting for tonight. */
export async function relayoutKeysNow() {
  await assertArea(null);
  const { relayoutApprovedKeysBatch } = await import("@/lib/solutionDraft");
  const r = await relayoutApprovedKeysBatch(4, 235_000);
  revalidatePath("/admin/solutions");
  redirect(`/admin/solutions?relaid=${r.done.length}&relayoutleft=${r.remaining}&relayoutfailed=${r.failed.length}`);
}

/** Replace the approved key with its new layout. */
export async function adoptPendingLayout(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) redirect("/admin/solutions");
  const svc = createServiceClient();

  const { data: row } = await svc.from("item_solutions").select("id, pending_md, section_id").eq("id", id).maybeSingle();
  const text = String(row?.pending_md ?? "").trim();
  if (!text) redirect("/admin/solutions?adopted=0");

  await svc
    .from("item_solutions")
    .update({ solution_md: text, pending_md: null, pending_at: null, approved_at: new Date().toISOString() })
    .eq("id", id);

  // The marking guide was built from the OLD text, so it no longer describes
  // the key it is supposed to break down. Drop it; the next submission on this
  // test rebuilds it from the adopted key.
  if (row?.section_id) await svc.from("marking_schemes").delete().eq("section_id", row.section_id);

  revalidatePath("/admin/solutions");
  redirect("/admin/solutions?adopted=1");
}

/** Keep the existing key and throw the new layout away. */
export async function discardPendingLayout(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) redirect("/admin/solutions");
  await createServiceClient()
    .from("item_solutions")
    .update({ pending_md: null, pending_at: null, pending_error: null })
    .eq("id", id);
  revalidatePath("/admin/solutions");
  redirect("/admin/solutions?discarded=1");
}

/** Adopt every new layout that is waiting. */
export async function adoptAllPendingLayouts() {
  await assertArea(null);
  const svc = createServiceClient();
  const { data: rows } = await svc
    .from("item_solutions")
    .select("id, pending_md, section_id")
    .not("pending_md", "is", null)
    .limit(500);

  const list = (rows ?? []).filter((r) => String(r.pending_md ?? "").trim());
  if (!list.length) redirect("/admin/solutions?adoptedall=0");

  for (const r of list) {
    await svc
      .from("item_solutions")
      .update({ solution_md: String(r.pending_md), pending_md: null, pending_at: null, approved_at: new Date().toISOString() })
      .eq("id", r.id);
    if (r.section_id) await svc.from("marking_schemes").delete().eq("section_id", String(r.section_id));
  }

  revalidatePath("/admin/solutions");
  redirect(`/admin/solutions?adoptedall=${list.length}`);
}
