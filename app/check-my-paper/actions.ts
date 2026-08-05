"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyFaculty } from "@/lib/notify";

// Submit an answer book for checking, with no plan and no test window.
//
// This is deliberately NOT a second marking pipeline. It creates a real
// descriptive attempt against a real test, so the paper is marked against CA
// Parveen Sharma's approved answer key and step marking guide, verified by an
// examiner and returned annotated — exactly what a paid student gets. The only
// difference is how the student got here and that the finished copy is emailed.
//
// That is why the form insists on WHICH TEST. Without it there is no key, and
// marking from the model's own knowledge is the one thing he ruled out.

export async function submitForChecking(formData: FormData) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/check-my-paper");

  const sectionId = String(formData.get("section_id") ?? "").trim();
  const fileUrl = String(formData.get("file_url") ?? "").trim();
  const name = String(formData.get("full_name") ?? "").trim();

  if (!sectionId) redirect("/check-my-paper?err=Choose which test this paper is for");
  if (!fileUrl) redirect("/check-my-paper?err=Upload your answer book as one PDF");

  const svc = createServiceClient();

  // Keep the name they gave — it goes on the annotated copy and is often the
  // only thing that identifies a paper written before they had an account.
  if (name) {
    await svc.from("profiles").update({ full_name: name }).eq("id", user.id).is("full_name", null);
  }

  // One attempt per student per test. If the last one is finished they may send
  // another; if it is still in the queue, say so rather than silently replacing
  // a paper that is halfway through being marked.
  const { data: existing } = await svc
    .from("descriptive_attempts")
    .select("id, review_status, status")
    .eq("student_id", user.id)
    .eq("section_id", sectionId)
    .maybeSingle();

  if (existing) {
    if (existing.review_status !== "checked") {
      redirect("/check-my-paper?err=That paper is already with us and is being checked. You will get an email when it is ready.");
    }
    await svc.from("descriptive_attempts").delete().eq("id", existing.id);
  }

  const now = new Date();
  const { data: made, error } = await svc
    .from("descriptive_attempts")
    .insert({
      student_id: user.id,
      section_id: sectionId,
      started_at: now.toISOString(),
      // No exam clock on this route — the point is that the clock already ran
      // out. The deadline is set past the submission so nothing expires it.
      deadline_at: new Date(now.getTime() + 3600_000).toISOString(),
      submitted_at: now.toISOString(),
      status: "submitted",
      review_status: "pending",
      file_url: fileUrl,
      source: "paper_check",
    })
    .select("id")
    .maybeSingle();

  if (error || !made) {
    console.error("[paper_check] could not record the submission", error?.message);
    redirect("/check-my-paper?err=Something went wrong recording it. Please try once more.");
  }

  // Start the marking now rather than waiting for the next sweep.
  try {
    const { waitUntil } = await import("@vercel/functions");
    const { gradeSubmittedPaper } = await import("@/app/learn/section/[sectionId]/paperActions");
    waitUntil(
      gradeSubmittedPaper(String(made.id)).catch((e) =>
        console.error("[paper_check] marking failed", e instanceof Error ? e.message : e),
      ),
    );
  } catch { /* the five-minute cron is the safety net */ }

  await notifyFaculty(
    "A paper came in for checking",
    `Student: ${user.email}\nTest: ${sectionId}\nIt is in the examiner desk once the AI has marked it.`,
  ).catch(() => {});

  revalidatePath("/check-my-paper");
  redirect("/check-my-paper?sent=1");
}
