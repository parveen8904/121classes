"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { gradeDescriptivePaper, type DescriptiveGrade } from "@/lib/ai";
import { notifyFaculty } from "@/lib/notify";

export type PaperAttempt = {
  status: "none" | "started" | "submitted" | "graded" | "expired";
  startedAt?: string;
  deadlineAt?: string;
  submittedAt?: string;
  fileUrl?: string;
  awarded?: number | null;
  total?: number | null;
  report?: DescriptiveGrade | null;
};

type Row = {
  id: string;
  status: string;
  started_at: string;
  deadline_at: string;
  submitted_at: string | null;
  file_url: string | null;
  awarded_marks: number | null;
  total_marks: number | null;
  report: DescriptiveGrade | null;
};

async function paperCfg(sectionId: string) {
  const { data } = await createServiceClient().from("sections").select("config").eq("id", sectionId).maybeSingle();
  const c = (data?.config ?? {}) as Record<string, unknown>;
  return {
    questionPdf: (c.paper_question_pdf as string) || "",
    solutionPdf: (c.paper_solution_pdf as string) || "",
    duration: Number(c.paper_duration_minutes) || 30,
    totalMarks: Number(c.paper_total_marks) || 0,
  };
}

function toAttempt(row: Row | null): PaperAttempt {
  if (!row) return { status: "none" };
  // Past deadline and never submitted → the window is closed.
  const expired = row.status === "started" && new Date(row.deadline_at).getTime() < Date.now();
  return {
    status: expired ? "expired" : (row.status as PaperAttempt["status"]),
    startedAt: row.started_at,
    deadlineAt: row.deadline_at,
    submittedAt: row.submitted_at ?? undefined,
    fileUrl: row.file_url ?? undefined,
    awarded: row.awarded_marks,
    total: row.total_marks,
    report: row.report,
  };
}

export async function getMyPaperAttempt(sectionId: string): Promise<PaperAttempt> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "none" };
  const { data } = await supabase.from("descriptive_attempts").select("*").eq("student_id", user.id).eq("section_id", sectionId).maybeSingle();
  return toAttempt(data as Row | null);
}

// Starting = downloading the question paper. The clock begins now and cannot be
// restarted. Deadline = scheduled time + 10 minutes to upload.
export async function startPaperAttempt(sectionId: string): Promise<PaperAttempt & { questionPdf?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "none" };
  const cfg = await paperCfg(sectionId);

  const { data: existing } = await supabase.from("descriptive_attempts").select("*").eq("student_id", user.id).eq("section_id", sectionId).maybeSingle();
  if (existing) return { ...toAttempt(existing as Row), questionPdf: cfg.questionPdf };

  const now = Date.now();
  const deadline = new Date(now + (cfg.duration + 10) * 60 * 1000).toISOString();
  const { data: ins } = await supabase
    .from("descriptive_attempts")
    .insert({ student_id: user.id, section_id: sectionId, started_at: new Date(now).toISOString(), deadline_at: deadline, total_marks: cfg.totalMarks || null, status: "started" })
    .select("*")
    .maybeSingle();
  return { ...toAttempt(ins as Row | null), questionPdf: cfg.questionPdf };
}

async function gradeAndStore(row: Row, sectionId: string): Promise<PaperAttempt> {
  const cfg = await paperCfg(sectionId);
  const svc = createServiceClient();
  let graded: DescriptiveGrade | null = null;
  try {
    if (cfg.solutionPdf && row.file_url) graded = await gradeDescriptivePaper(row.file_url, cfg.solutionPdf, cfg.totalMarks || row.total_marks || null);
  } catch {
    graded = null;
  }
  if (graded) {
    await svc.from("descriptive_attempts").update({ status: "graded", awarded_marks: graded.awarded, total_marks: graded.total, report: graded }).eq("id", row.id);
    return { status: "graded", fileUrl: row.file_url ?? undefined, submittedAt: row.submitted_at ?? undefined, deadlineAt: row.deadline_at, awarded: graded.awarded, total: graded.total, report: graded };
  }
  return { status: "submitted", fileUrl: row.file_url ?? undefined, submittedAt: row.submitted_at ?? undefined, deadlineAt: row.deadline_at, total: row.total_marks };
}

export async function submitPaperAttempt(input: { sectionId: string; fileUrl: string }): Promise<PaperAttempt> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "none" };
  if (!input.fileUrl) return { status: "none" };

  const { data: row } = await supabase.from("descriptive_attempts").select("*").eq("student_id", user.id).eq("section_id", input.sectionId).maybeSingle();
  const r = row as Row | null;
  if (!r) return { status: "none" };
  if (r.status === "submitted" || r.status === "graded") return toAttempt(r);
  if (new Date(r.deadline_at).getTime() < Date.now()) {
    await createServiceClient().from("descriptive_attempts").update({ status: "expired" }).eq("id", r.id);
    return { ...toAttempt(r), status: "expired" };
  }

  const submittedAt = new Date().toISOString();
  await createServiceClient().from("descriptive_attempts").update({ file_url: input.fileUrl, submitted_at: submittedAt, status: "submitted" }).eq("id", r.id);
  try {
    if (user.email) await notifyFaculty("A descriptive paper was submitted", `Student: ${user.email}\nPaper: ${input.sectionId}\nUploaded answer: ${input.fileUrl}`);
  } catch { /* non-blocking */ }

  return gradeAndStore({ ...r, file_url: input.fileUrl, submitted_at: submittedAt, status: "submitted" }, input.sectionId);
}

// Retry grading for a submitted-but-not-yet-graded paper (e.g. AI was busy/off).
export async function gradePaperNow(sectionId: string): Promise<PaperAttempt> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "none" };
  const { data: row } = await supabase.from("descriptive_attempts").select("*").eq("student_id", user.id).eq("section_id", sectionId).maybeSingle();
  const r = row as Row | null;
  if (!r || !r.file_url) return toAttempt(r);
  if (r.status === "graded") return toAttempt(r);
  return gradeAndStore(r, sectionId);
}
