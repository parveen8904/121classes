"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveFileUrl } from "@/lib/storage";
import { gradeDescriptivePaper } from "@/lib/ai";

// A student submits their own answer to a practice paper (MTP / RTP / past
// paper). We store the attempt, then — if the paper has a suggested-answers PDF
// — the AI evaluates the student's answers against it and saves a report.
export async function submitPaperAnswer(input: { itemId: string; fileUrl: string }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { itemId, fileUrl } = input;
  if (!itemId || !fileUrl) return;

  const svc = createServiceClient();
  const { data: item } = await svc
    .from("repository_items")
    .select("id, solution_url, subject_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return;

  const { data: attempt } = await svc
    .from("paper_attempts")
    .insert({ repo_item_id: itemId, student_id: user.id, file_url: fileUrl, status: "submitted" })
    .select("id")
    .single();

  // Evaluate against the answer key: the uploaded suggested-answers PDF if the
  // paper has one, otherwise the solution CA Parveen Sharma has approved for
  // it. An unapproved draft is never used — the attempt simply stays
  // "submitted" for the examiner desk.
  const { approvedSolution } = await import("@/lib/solutionDraft");
  const approvedText = item.solution_url ? null : await approvedSolution(itemId);

  if ((item.solution_url || approvedText) && attempt?.id) {
    try {
      const studentUrl = await resolveFileUrl(fileUrl);
      const graded = approvedText
        ? await (await import("@/lib/ai")).gradeDescriptivePaperAgainstText(studentUrl, approvedText, null)
        : await gradeDescriptivePaper(studentUrl, await resolveFileUrl(item.solution_url as string), null);
      if (graded) {
        await svc.from("paper_attempts").update({
          status: "graded",
          awarded_marks: graded.awarded,
          total_marks: graded.total,
          report: graded,
        }).eq("id", attempt.id);
      }
    } catch { /* leave as submitted; faculty can review */ }
  }
  revalidatePath(`/learn/paper/${itemId}`);
}

// Evaluation can fail for reasons that have nothing to do with the student —
// the AI was off, the request was too large, the key was rate-limited. Without
// a way to try again the attempt sat on "being prepared" for ever, so this
// re-runs the grading for the student's own latest attempt.
export async function evaluatePaperNow(itemId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const svc = createServiceClient();
  const { data: attempt } = await svc
    .from("paper_attempts")
    .select("id, file_url, status")
    .eq("repo_item_id", itemId)
    .eq("student_id", user.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!attempt?.file_url || attempt.status === "graded") return;

  const { data: item } = await svc
    .from("repository_items")
    .select("id, solution_url")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return;

  const { approvedSolution } = await import("@/lib/solutionDraft");
  const approvedText = item.solution_url ? null : await approvedSolution(itemId);
  if (!item.solution_url && !approvedText) return;

  try {
    const studentUrl = await resolveFileUrl(attempt.file_url);
    const graded = approvedText
      ? await (await import("@/lib/ai")).gradeDescriptivePaperAgainstText(studentUrl, approvedText, null)
      : await gradeDescriptivePaper(studentUrl, await resolveFileUrl(item.solution_url as string), null);
    if (graded) {
      await svc.from("paper_attempts").update({
        status: "graded",
        awarded_marks: graded.awarded,
        total_marks: graded.total,
        report: graded,
      }).eq("id", attempt.id);
    }
  } catch { /* stays submitted; the examiner desk still has it */ }
  revalidatePath(`/learn/paper/${itemId}`);
}
