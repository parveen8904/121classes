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
    .select("id, student_id, section_id, awarded_marks, total_marks, examiner_id, review_status, source, annotated_url")
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
       ${
         // A paper sent in through the free checking service has no course page
         // to open — that student may have no plan at all. Send them straight
         // to the one page that holds their copy.
         row.source === "paper_check"
           ? `<p><a href="https://caparveensharma.com/check-my-paper">Open your checked copy and the official answers</a> — the marks are written on your own pages, with a summary and the full solutions at the end.</p>
              <p class="muted">Want the classes, the day-by-day plan and unlimited tests? <a href="https://caparveensharma.com/courses">See the courses</a>.</p>`
           : `<p>Open the test on the portal to see your checked copy and detailed feedback. 📚</p>`
       }`,
    ),
    template: "copy_checked",
    payload: { sectionId: row.section_id },
  }).catch(() => null);

  revalidatePath("/examiner");
  redirect("/examiner?done=1");
}

/**
 * The examiner checks it themselves.
 *
 * Until now the only choice was to accept the AI's marking and release it. An
 * examiner who disagreed had no way to put their OWN marked copy in front of
 * the student. They download the copy, annotate it however they normally do,
 * and upload it here — it replaces the AI's version as the checked copy the
 * student receives. Releasing is still a separate, deliberate press.
 */
export async function saveExaminerCopy(formData: FormData) {
  const ex = await requireExaminer();
  if (!ex) return;
  const id = str(formData.get("id"));
  const url = str(formData.get("annotated_url"));
  if (!id || !url) return;

  const svc = createServiceClient();
  const { data: row } = await svc
    .from("descriptive_attempts")
    .select("id, examiner_id, review_status")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.review_status === "checked") return;
  if (row.examiner_id && row.examiner_id !== ex.id) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { data: me } = await supabase.from("profiles").select("role").eq("id", user!.id).maybeSingle();
    if (me?.role !== "admin") return;
  }

  await svc
    .from("descriptive_attempts")
    .update({ annotated_url: url, examiner_id: ex.id, examiner_name: ex.name })
    .eq("id", id);

  revalidatePath(`/examiner/${id}`);
}

// GIVE A STUDENT MORE TIME.
//
// A descriptive test runs to a clock: so many minutes to solve, ten more to
// scan and upload, and then the upload closes. That is right — it is a timed
// test — but until now there was NO WAY to reopen it. On 13 August a student
// ran out with his paper written in front of him, and reopening it meant
// editing the database by hand, twice, while he waited. Anyone without a
// database console had nothing to offer him at all.
//
// So this exists, and it is deliberately small: it moves the deadline, and if
// the attempt had already closed it puts it back to "started" so the upload
// screen returns. It does not touch marks, does not clear the paper, and does
// not give a fresh sight of the questions — the student has already seen them,
// and a reset would be a second attempt rather than a fair finish to the first.
export async function giveMoreTime(formData: FormData) {
  const ex = await requireExaminer();
  if (!ex) return;

  const id = str(formData.get("id"));
  // Fifteen minutes is the default because the usual cause is a scan that took
  // longer than expected, not a paper that was never written.
  const minutes = Math.min(180, Math.max(5, Number(formData.get("minutes")) || 15));
  if (!id) return;

  const svc = createServiceClient();
  const { data: row } = await svc
    .from("descriptive_attempts")
    .select("id, status, student_id, section_id, extra_time_minutes")
    .eq("id", id)
    .maybeSingle();
  const r = row as { id: string; status: string; student_id: string; section_id: string; extra_time_minutes: number | null } | null;
  // Already handed in. Reopening a submitted or graded paper would let somebody
  // replace an answer after seeing a mark, so it is refused.
  if (!r || !["started", "expired"].includes(r.status)) return;

  await svc.from("descriptive_attempts").update({
    deadline_at: new Date(Date.now() + minutes * 60_000).toISOString(),
    status: "started",
    // WHO DID IT, AND HOW MUCH — kept on the attempt, so it is in front of the
    // next examiner deciding whether to grant it again. Cumulative: three
    // fifteen-minute grants should read as forty-five, not fifteen.
    extra_time_minutes: (Number(r.extra_time_minutes) || 0) + minutes,
    extra_time_by: ex.name,
    extra_time_at: new Date().toISOString(),
  }).eq("id", r.id);

  // And TELL the student, because the page they are looking at is still
  // counting down from the old deadline and will keep saying "time over" until
  // it is reloaded. That single fact cost most of an evening.
  try {
    const { data: p } = await svc.from("profiles").select("email, full_name").eq("id", r.student_id).maybeSingle();
    const who = p as { email: string | null; full_name: string | null } | null;
    if (who?.email) {
      await notifyByEmail({
        studentId: r.student_id,
        email: who.email,
        subject: "⏱️ Your test has been reopened",
        template: "descriptive_more_time",
        payload: { minutes, sectionId: r.section_id },
        html: emailShell(
          "Your test is open again",
          `<p>Dear ${who.full_name || "Student"},</p>
           <p>Your test has been reopened for <strong>${minutes} more minutes</strong> so you can upload your answers.</p>
           <p><strong>Please close the test page and open it again</strong> — the timer only shows the new time after
              the page is reloaded. Then choose your answer PDF, or photographs of your pages, and press Submit.</p>
           <p>— CA Parveen Sharma classes</p>`,
        ),
      });
    }
  } catch { /* the extra time matters more than the email */ }

  revalidatePath("/examiner");
  redirect("/examiner?status=stuck&done=time");
}

// REBUILD ONE CHECKED COPY, WITHOUT MARKING THE PAPER AGAIN.
//
// The marks and the checked copy are two separate things: the marking is an AI
// call costing real money, the copy is a PDF drawn from a report we already
// hold. When the copy is missing — as it was for mock paper 1, which marked
// 69/100 across 26 questions and produced no document at all — re-marking to
// get it would pay twice for an answer we already have, and could return
// different marks on a paper an examiner may already have read.
//
// This draws the copy from the stored report. It works from the ATTEMPT, so it
// covers a chapter test and a mock paper alike; the older rebuild is keyed on
// the section and cannot see a mock paper at all.
export async function rebuildCopyForAttempt(formData: FormData) {
  const ex = await requireExaminer();
  if (!ex) return;
  const id = str(formData.get("id"));
  if (!id) return;

  const svc = createServiceClient();
  const { data: row } = await svc.from("descriptive_attempts").select("*").eq("id", id).maybeSingle();
  const r = row as Record<string, unknown> | null;
  if (!r?.file_url || !r.report) redirect("/examiner?err=" + encodeURIComponent("That copy has no marked report to draw from."));

  const { resolveFileUrl } = await import("@/lib/storage");
  const studentUrl = await resolveFileUrl(String(r!.file_url));
  if (!studentUrl) redirect("/examiner?err=" + encodeURIComponent("The student's answer book could not be opened."));

  // The official answers, from wherever this paper's key lives.
  let officialPdf: string | null = null;
  let officialText: string | null = null;
  if (r!.mock_paper_id) {
    const { data: m } = await svc.from("mock_papers")
      .select("answers_md, answers_pdf_url").eq("id", String(r!.mock_paper_id)).maybeSingle();
    const mm = m as { answers_md: string | null; answers_pdf_url: string | null } | null;
    officialText = mm?.answers_md ?? null;
    officialPdf = mm?.answers_pdf_url ? await resolveFileUrl(mm.answers_pdf_url, 900) : null;
  } else if (r!.section_id) {
    const { data: k } = await svc.from("item_solutions")
      .select("solution_md, status").eq("section_id", String(r!.section_id)).maybeSingle();
    const kk = k as { solution_md: string | null; status: string | null } | null;
    if (kk?.status === "approved") officialText = kk.solution_md;
  }

  const { buildAnnotatedPdf } = await import("@/app/learn/section/[sectionId]/paperActions");
  const bytes = await buildAnnotatedPdf(
    studentUrl,
    r!.report as never,
    { pdfUrl: officialPdf, text: officialText },
  );
  if (!bytes) redirect("/examiner?err=" + encodeURIComponent("The copy could not be drawn — the answer book may be unreadable or protected."));

  const path = `descriptive/rebuilt/${id}-checked.pdf`;
  const up = await svc.storage.from("secure").upload(path, Buffer.from(bytes!), {
    contentType: "application/pdf", upsert: true,
  });
  if (up.error) redirect("/examiner?err=" + encodeURIComponent("The copy was drawn but could not be saved."));

  await svc.from("descriptive_attempts").update({ annotated_url: `secure:${path}` }).eq("id", id);
  revalidatePath("/examiner");
  redirect("/examiner?done=copy");
}
