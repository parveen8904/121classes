"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { str } from "../_lib/util";
import { draftMockPaper, ensureSeptember2026Set } from "@/lib/mockPapers";

// Draft one paper. It is two long AI calls — the questions, then the answers to
// those exact questions — so it is one press per paper rather than a batch that
// times out halfway and leaves nobody knowing which ones are real.
export async function draftOne(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  const r = await draftMockPaper(id);
  revalidatePath("/admin/mock-papers");
  redirect(`/admin/mock-papers?${r.ok ? "drafted=1" : `err=${encodeURIComponent(r.error ?? "failed")}`}`);
}

// Draft EVERY paper still waiting, one after another.
//
// Three papers is six long AI calls — questions, then the answers to those
// exact questions, per paper — so this takes a few minutes and stops when the
// time runs out rather than dying halfway with nobody knowing which papers are
// real. Press it again to carry on.
export async function draftAllQueued() {
  await assertArea(null);
  const svc = createServiceClient();
  const { data: waiting } = await svc
    .from("mock_papers")
    .select("id")
    .in("status", ["questions_ready", "queued", "failed", "halted"])
    .order("paper_no")
    .limit(10);

  // Pressing the button is a person deciding to try again, so it clears the
  // halt and the attempt count. The cron never does that by itself.
  await svc
    .from("mock_papers")
    .update({ status: "questions_ready", attempts: 0, error: null })
    .eq("status", "halted")
    .not("questions_md", "is", null);
  await svc
    .from("mock_papers")
    .update({ status: "queued", attempts: 0, error: null })
    .eq("status", "halted")
    .is("questions_md", null);

  const started = Date.now();
  let done = 0;
  const failed: string[] = [];
  for (const row of waiting ?? []) {
    // A page action is killed at 300 seconds, and one STAGE — questions, or the
    // answers to them — takes about 170. So exactly one stage per press: the
    // founder's two presses before this both hit 504 and stranded the paper
    // they were working on, which is worse than doing nothing.
    if (done >= 1 || Date.now() - started > 60_000) break;
    const r = await draftMockPaper(String(row.id));
    if (r.ok) done += 1;
    else failed.push(r.error ?? "failed");
  }

  const { count: left } = await svc
    .from("mock_papers")
    .select("id", { count: "exact", head: true })
    .in("status", ["questions_ready", "queued", "failed"]);

  revalidatePath("/admin/mock-papers");
  redirect(`/admin/mock-papers?drafted=${done}&left=${left ?? 0}${failed[0] ? `&err=${encodeURIComponent(failed[0])}` : ""}`);
  // Note: the ten-minute cron does this on its own — the button is only for
  // somebody who does not want to wait.
}

// Start a paper over from nothing.
//
// "Draft it again" did not do this and could not: draftMockPaper looks at what
// is already saved and carries on from there — which is right when a paper is
// half-written, and wrong when the paper itself is the problem. Pressing it on
// paper 1 finished the long version rather than replacing it.
//
// This clears the questions, the answers and the counters, so the next pass
// writes a genuinely new paper under the current instructions.
export async function redraftFromScratch(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient()
    .from("mock_papers")
    .update({
      questions_md: null,
      answers_md: null,
      answers_progress: 0,
      attempts: 0,
      status: "queued",
      error: null,
      generated_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidatePath("/admin/mock-papers");
  redirect("/admin/mock-papers?restarted=1");
}

export async function createSet() {
  await assertArea(null);
  const n = await ensureSeptember2026Set();
  revalidatePath("/admin/mock-papers");
  redirect(`/admin/mock-papers?made=${n}`);
}

// Approving is the whole point. Until he does, no student sees it — his name is
// on every question in it.
export async function approvePaper(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient()
    .from("mock_papers")
    .update({ status: "approved", approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/admin/mock-papers");
  revalidatePath("/mock-tests");
  redirect("/admin/mock-papers?approved=1");
}

export async function unapprovePaper(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient()
    .from("mock_papers")
    .update({ status: "drafted", approved_at: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/admin/mock-papers");
  revalidatePath("/mock-tests");
  redirect("/admin/mock-papers?pulled=1");
}

/** Correct anything by hand — his paper, his wording. */
export async function savePaper(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient()
    .from("mock_papers")
    .update({
      questions_md: str(formData.get("questions_md")),
      answers_md: str(formData.get("answers_md")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidatePath("/admin/mock-papers");
  redirect("/admin/mock-papers?saved=1");
}

// ---------------------------------------------------------------------------
// HIS OWN PAPERS
//
// The AI drafting stays for when it is wanted, but it is no longer the only
// way in. A paper he has written himself is uploaded as a PDF and served to
// students EXACTLY as he made it — his layout, his typesetting, untouched by
// ours. We only read the text out of it underneath, so the checker still knows
// what the questions and the answers were.
//
// Solutions are a separate matter. They are stored privately and used for
// checking; they are never served to a student. That rule does not change
// because the file arrived from him rather than from the AI.
// ---------------------------------------------------------------------------

const BUCKET = "secure";

async function storePdf(file: File, key: string): Promise<{ ref: string; text: string } | null> {
  if (!file || file.size === 0) return null;
  const svc = createServiceClient();
  const bytes = Buffer.from(await file.arrayBuffer());
  const path = `mock-papers/${key}.pdf`;
  const up = await svc.storage.from(BUCKET).upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (up.error) return null;

  // Read the text out for the checker. A signed URL because the bucket is
  // private — the file itself must never become publicly fetchable.
  let text = "";
  try {
    const { data: signed } = await svc.storage.from(BUCKET).createSignedUrl(path, 120);
    if (signed?.signedUrl) {
      const { extractPdfText, cleanPdfText } = await import("@/lib/pdf");
      text = cleanPdfText(await extractPdfText(signed.signedUrl));
    }
  } catch { /* the file is stored either way; the text is a bonus */ }

  return { ref: `secure:${path}`, text };
}

/**
 * Attach his own question paper and/or solutions to an existing paper.
 *
 * Either file on its own is fine — the question paper today, the solutions
 * when they are written. Uploading a question paper is what makes students see
 * his file instead of ours.
 */
export async function uploadPaperFiles(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  if (!id) return;

  const paper = formData.get("paper_pdf") as File | null;
  const answers = formData.get("answers_pdf") as File | null;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (paper && paper.size > 0) {
    const stored = await storePdf(paper, `${id}-paper`);
    if (!stored) redirect("/admin/mock-papers?err=upload");
    patch.paper_pdf_url = stored.ref;
    patch.source = "uploaded";
    // Keep the text in step so search, the checker and the on-screen preview
    // are all describing the file students actually get.
    if (stored.text) patch.questions_md = stored.text;
  }

  if (answers && answers.size > 0) {
    const stored = await storePdf(answers, `${id}-answers`);
    if (!stored) redirect("/admin/mock-papers?err=upload");
    patch.answers_pdf_url = stored.ref;
    if (stored.text) patch.answers_md = stored.text;
    patch.answers_progress = 100;
  }

  if (Object.keys(patch).length === 1) redirect("/admin/mock-papers?err=nofile");

  await createServiceClient().from("mock_papers").update(patch).eq("id", id);
  revalidatePath("/admin/mock-papers");
  revalidatePath("/mock-tests");
  redirect("/admin/mock-papers?uploaded=1");
}

/** Take his file away and fall back to whatever we hold as text. */
export async function removeUploadedPaper(formData: FormData) {
  await assertArea(null);
  const id = str(formData.get("id"));
  const which = str(formData.get("which")); // "paper" | "answers"
  if (!id || (which !== "paper" && which !== "answers")) return;
  const svc = createServiceClient();
  await svc.storage.from(BUCKET).remove([`mock-papers/${id}-${which}.pdf`]);
  await svc.from("mock_papers")
    .update({ [which === "paper" ? "paper_pdf_url" : "answers_pdf_url"]: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/admin/mock-papers");
  revalidatePath("/mock-tests");
  redirect("/admin/mock-papers?removed=1");
}

/** A paper that begins as his file — no AI anywhere in it. */
export async function createUploadedPaper(formData: FormData) {
  await assertArea(null);
  const svc = createServiceClient();
  const title = str(formData.get("title"));
  const paper = formData.get("paper_pdf") as File | null;
  if (!title || !paper || paper.size === 0) redirect("/admin/mock-papers?err=nofile");

  const { data: row } = await svc.from("mock_papers").insert({
    course: str(formData.get("course")) || "CA Final",
    subject: str(formData.get("subject")) || "Financial Reporting",
    attempt_label: str(formData.get("attempt_label")) || "September 2026",
    paper_no: Number(formData.get("paper_no")) || 1,
    title,
    total_marks: Number(formData.get("total_marks")) || 100,
    duration_min: Number(formData.get("duration_min")) || 180,
    status: "drafted",
    source: "uploaded",
  }).select("id").single();
  if (!row) redirect("/admin/mock-papers?err=upload");

  const stored = await storePdf(paper, `${row.id}-paper`);
  const answersFile = formData.get("answers_pdf") as File | null;
  const storedAns = answersFile && answersFile.size > 0 ? await storePdf(answersFile, `${row.id}-answers`) : null;

  await svc.from("mock_papers").update({
    paper_pdf_url: stored?.ref ?? null,
    questions_md: stored?.text || null,
    answers_pdf_url: storedAns?.ref ?? null,
    answers_md: storedAns?.text || null,
    answers_progress: storedAns ? 100 : 0,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);

  revalidatePath("/admin/mock-papers");
  redirect("/admin/mock-papers?uploaded=1");
}
