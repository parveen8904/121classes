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
