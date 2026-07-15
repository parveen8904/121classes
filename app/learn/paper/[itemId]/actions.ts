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

  // Evaluate against the suggested answers (if the admin uploaded them).
  if (item.solution_url && attempt?.id) {
    try {
      const [studentUrl, solutionUrl] = await Promise.all([
        resolveFileUrl(fileUrl),
        resolveFileUrl(item.solution_url),
      ]);
      const graded = await gradeDescriptivePaper(studentUrl, solutionUrl, null);
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
