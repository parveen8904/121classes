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

// DESCRIPTIVE TESTS ONLY. The founder does not want keys drafted for the
// repository MTP/RTP papers — he deleted those rows deliberately — so nothing
// here queues or drafts them any more.
export async function queueAllMissing() {
  await assertArea(null);
  const r = await queueMissingSectionSolutions();
  revalidatePath("/admin/solutions");
  redirect(`/admin/solutions?queued=${r.queued}`);
}

// Draft the waiting ones NOW rather than waiting for tonight's run. Drafting a
// whole paper is a long AI call, so one press takes as many as fit in the time
// available and says how many are left — press again to continue.
export async function draftWaitingNow() {
  await assertArea(null);
  // Five at a time: a paper is one long AI call, so drafting them one after
  // another managed barely two per press.
  const r = await draftSectionSolutionsBatch(5, 240_000);
  revalidatePath("/admin/solutions");
  redirect(
    `/admin/solutions?drafted=${r.drafted.length}&draftfailed=${r.failed.length}&stillqueued=${r.remaining}`,
  );
}

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
export async function generateExplanations() {
  await assertArea(null);
  const { backfillMcqExplanations, backfillCaseExplanations } = await import("@/lib/explainBackfill");
  const started = Date.now();
  let mcq = 0;
  let cases = 0;
  while (Date.now() - started < 25_000) {
    const n = await backfillMcqExplanations(20);
    mcq += n;
    if (!n) break;
  }
  while (Date.now() - started < 45_000) {
    const n = await backfillCaseExplanations(20);
    cases += n;
    if (!n) break;
  }
  revalidatePath("/admin/solutions");
  redirect(`/admin/solutions?mcq=${mcq}&cases=${cases}`);
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

/** Delete every ticked key in one go. */
export async function deleteSelectedSolutions(formData: FormData) {
  await assertArea(null);
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) redirect("/admin/solutions?removed=0");
  await createServiceClient().from("item_solutions").delete().in("id", ids);
  revalidatePath("/admin/solutions");
  redirect(`/admin/solutions?removed=${ids.length}`);
}

/** Put the ticked ones back in the queue to be drafted again. */
export async function requeueSelectedSolutions(formData: FormData) {
  await assertArea(null);
  const ids = formData.getAll("ids").map((v) => String(v)).filter(Boolean);
  if (!ids.length) redirect("/admin/solutions?requeued=0");
  await createServiceClient()
    .from("item_solutions")
    .update({ status: "queued", solution_md: null, error: null, claimed_at: null })
    .in("id", ids);
  revalidatePath("/admin/solutions");
  redirect(`/admin/solutions?requeued=${ids.length}`);
}
