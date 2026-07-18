"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyByEmail, emailShell } from "@/lib/notify";
import { str } from "../admin/_lib/util";

// Examiners are faculty or admins.
async function requireExaminer(): Promise<{ id: string; name: string } | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: p } = await supabase.from("profiles").select("role, full_name").eq("id", user.id).maybeSingle();
  if (p?.role !== "admin" && p?.role !== "faculty") return null;
  return { id: user.id, name: (p?.full_name as string) || "Examiner" };
}

// Claim a copy for checking. Atomic: only succeeds while it is still pending,
// so two examiners can never claim the same copy.
export async function claimCopy(formData: FormData) {
  const ex = await requireExaminer();
  if (!ex) return;
  const id = str(formData.get("id"));
  const svc = createServiceClient();
  await svc
    .from("descriptive_attempts")
    .update({ review_status: "checking", examiner_id: ex.id, examiner_name: ex.name, examiner_started_at: new Date().toISOString() })
    .eq("id", id)
    .eq("review_status", "pending");
  revalidatePath("/examiner");
  redirect(`/examiner/${id}`);
}

// Put a claimed copy back in the pending pool (only by its own examiner/admin).
export async function unclaimCopy(formData: FormData) {
  const ex = await requireExaminer();
  if (!ex) return;
  const id = str(formData.get("id"));
  const svc = createServiceClient();
  const { data: row } = await svc.from("descriptive_attempts").select("examiner_id, review_status").eq("id", id).maybeSingle();
  if (!row || row.review_status !== "checking") return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle();
  if (row.examiner_id !== ex.id && me?.role !== "admin") return;
  await svc
    .from("descriptive_attempts")
    .update({ review_status: "pending", examiner_id: null, examiner_name: null, examiner_started_at: null })
    .eq("id", id);
  revalidatePath("/examiner");
  redirect("/examiner");
}

// Submit the verification: final marks + remarks; releases the copy to the
// student and emails them.
export async function submitCheck(formData: FormData) {
  const ex = await requireExaminer();
  if (!ex) return;
  const id = str(formData.get("id"));
  const marksRaw = str(formData.get("marks"));
  const remarks = str(formData.get("remarks"));
  const marks = marksRaw === "" ? null : Number(marksRaw);

  const svc = createServiceClient();
  const { data: row } = await svc
    .from("descriptive_attempts")
    .select("id, student_id, section_id, awarded_marks, total_marks, examiner_id, review_status")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.review_status === "checked") return;
  // Only the claiming examiner (or an admin) can submit.
  if (row.examiner_id && row.examiner_id !== ex.id) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { data: me } = await supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle();
    if (me?.role !== "admin") return;
  }

  const finalMarks = Number.isFinite(marks as number) ? (marks as number) : row.awarded_marks;
  await svc
    .from("descriptive_attempts")
    .update({
      review_status: "checked",
      examiner_id: ex.id,
      examiner_name: ex.name,
      examiner_checked_at: new Date().toISOString(),
      examiner_marks: finalMarks,
      examiner_remarks: remarks || null,
      awarded_marks: finalMarks,
    })
    .eq("id", id);

  // Tell the student their checked copy is ready.
  const { data: student } = await svc.from("profiles").select("email").eq("id", row.student_id).maybeSingle();
  const { data: section } = await svc.from("sections").select("title, topic_id").eq("id", row.section_id).maybeSingle();
  await notifyByEmail({
    studentId: row.student_id as string,
    email: (student?.email as string) ?? null,
    subject: `✅ Your checked copy is ready — ${section?.title ?? "descriptive test"}`,
    html: emailShell(
      "Your copy has been checked 🧑‍🏫",
      `<p>The examiner has checked your descriptive paper <strong>${section?.title ?? ""}</strong>.</p>
       <p>Marks: <strong>${finalMarks ?? "—"}${row.total_marks ? ` / ${row.total_marks}` : ""}</strong></p>
       ${remarks ? `<p>Examiner's remarks: ${remarks}</p>` : ""}
       <p>Open the test on the portal to see your checked copy and detailed feedback. 📚</p>`,
    ),
    template: "copy_checked",
    payload: { sectionId: row.section_id },
  }).catch(() => null);

  revalidatePath("/examiner");
  redirect("/examiner?done=1");
}
