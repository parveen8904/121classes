"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertArea } from "@/lib/adminAccess";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { queueMissingSolutions } from "@/lib/solutionDraft";
import { str } from "../_lib/util";

// Approving is the whole point of this page: a drafted key does nothing until
// CA Parveen Sharma says it is right. Approval is what lets a solution reach a
// student and what lets the evaluator mark against it.

export async function queueAllMissing() {
  await assertArea(null);
  const r = await queueMissingSolutions(null);
  revalidatePath("/admin/solutions");
  redirect(`/admin/solutions?queued=${r.queued}`);
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
