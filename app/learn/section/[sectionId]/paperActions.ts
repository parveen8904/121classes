"use server";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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
  annotatedUrl?: string;
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
  annotated_url: string | null;
  awarded_marks: number | null;
  total_marks: number | null;
  report: DescriptiveGrade | null;
};

// ---- annotated "checked copy" builder (pdf-lib, server-side) ----
function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

const KIND_COLOR = {
  right: rgb(0.09, 0.6, 0.3),
  wrong: rgb(0.86, 0.15, 0.15),
  partial: rgb(0.85, 0.5, 0.05),
  tip: rgb(0.1, 0.4, 0.8),
} as const;

// Draw a small marking sign (tick / cross / dash / dot) at (x,y) on the page.
function drawSign(page: PDFPage, kind: keyof typeof KIND_COLOR, x: number, y: number) {
  const c = KIND_COLOR[kind];
  if (kind === "wrong") {
    page.drawLine({ start: { x, y: y + 6 }, end: { x: x + 11, y: y - 5 }, thickness: 2.2, color: c });
    page.drawLine({ start: { x: x + 11, y: y + 6 }, end: { x, y: y - 5 }, thickness: 2.2, color: c });
  } else if (kind === "right") {
    page.drawLine({ start: { x, y }, end: { x: x + 4, y: y - 5 }, thickness: 2.2, color: c });
    page.drawLine({ start: { x: x + 4, y: y - 5 }, end: { x: x + 13, y: y + 8 }, thickness: 2.2, color: c });
  } else if (kind === "partial") {
    page.drawLine({ start: { x, y: y + 1 }, end: { x: x + 12, y: y + 1 }, thickness: 2.2, color: c });
  } else {
    page.drawCircle({ x: x + 5, y: y + 1, size: 3.2, color: c });
  }
}

const KIND_LABEL = { right: "Correct", wrong: "Wrong", partial: "Partial", tip: "Tip" } as const;

// Returns the student's pages with marking signs + margin notes, plus a final
// summary page. null if it can't be built (caller falls back to the plain copy).
async function buildAnnotatedPdf(studentPdfUrl: string, grade: DescriptiveGrade): Promise<Uint8Array | null> {
  try {
    const res = await fetch(studentPdfUrl, { cache: "no-store" });
    if (!res.ok) return null;
    const srcBytes = new Uint8Array(await res.arrayBuffer());
    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.Helvetica);
    const fontB = await out.embedFont(StandardFonts.HelveticaBold);
    const src = await PDFDocument.load(srcBytes);
    const pageCount = src.getPageCount();
    const embedded = await out.embedPdf(srcBytes, Array.from({ length: pageCount }, (_, i) => i));

    const byPage = new Map<number, DescriptiveGrade["annotations"]>();
    for (const a of grade.annotations ?? []) {
      const p = Math.min(pageCount, Math.max(1, a.page));
      (byPage.get(p) ?? byPage.set(p, []).get(p)!).push(a);
    }

    const MARGIN = 230;
    for (let i = 0; i < pageCount; i++) {
      const ep = embedded[i];
      const ow = ep.width;
      const oh = ep.height;
      const page = out.addPage([ow + MARGIN, oh]);
      page.drawPage(ep, { x: 0, y: 0, width: ow, height: oh });
      page.drawLine({ start: { x: ow, y: 0 }, end: { x: ow, y: oh }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
      page.drawText("Checked by CA Parveen Sharma", { x: ow + 14, y: oh - 22, size: 9, font: fontB, color: rgb(0.05, 0.58, 0.53) });
      const list = (byPage.get(i + 1) ?? []).slice().sort((a, b) => a.y - b.y);
      for (const a of list) {
        const yTop = oh - Math.min(0.97, Math.max(0.03, a.y)) * oh;
        drawSign(page, a.kind, ow - 26, yTop);
        const cx = ow + 16;
        let yy = yTop + 2;
        page.drawText(KIND_LABEL[a.kind], { x: cx, y: yy, size: 8, font: fontB, color: KIND_COLOR[a.kind] });
        yy -= 11;
        for (const line of wrapText(a.note, font, 8.5, MARGIN - 28)) {
          page.drawText(line, { x: cx, y: yy, size: 8.5, font, color: rgb(0.15, 0.15, 0.15) });
          yy -= 10.5;
        }
      }
    }

    // Summary page
    const sp = out.addPage([595, 842]);
    const { width: sw, height: sh } = sp.getSize();
    let y = sh - 50;
    const line = (t: string, size: number, f: PDFFont, color = rgb(0.1, 0.1, 0.1), x = 40) => {
      for (const l of wrapText(t, f, size, sw - 80 - (x - 40))) {
        sp.drawText(l, { x, y, size, font: f, color });
        y -= size + 4;
      }
    };
    line("Marking summary", 18, fontB, rgb(0.05, 0.58, 0.53));
    y -= 6;
    line(`Score: ${grade.awarded} / ${grade.total}`, 13, fontB);
    if (grade.summary) line(grade.summary, 11, font);
    if (grade.per_question.length) {
      y -= 8;
      line("Marks per question", 12, fontB, rgb(0.05, 0.58, 0.53));
      for (const p of grade.per_question) line(`${p.q || "Q"}: ${p.awarded}/${p.max}  ${p.comment}`, 10, font, rgb(0.1, 0.1, 0.1), 48);
    }
    if (grade.improvements.length) {
      y -= 8;
      line("Where to improve", 12, fontB, rgb(0.05, 0.58, 0.53));
      for (const it of grade.improvements) line(`• ${it}`, 10, font, rgb(0.1, 0.1, 0.1), 48);
    }
    if (grade.concepts_to_revise.length) {
      y -= 8;
      line("Concepts to revise", 12, fontB, rgb(0.05, 0.58, 0.53));
      for (const it of grade.concepts_to_revise) line(`• ${it}`, 10, font, rgb(0.1, 0.1, 0.1), 48);
    }
    return await out.save();
  } catch {
    return null;
  }
}

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
    annotatedUrl: row.annotated_url ?? undefined,
    awarded: row.awarded_marks,
    total: row.total_marks,
    report: row.report,
  };
}

// Admin preview: wipe MY OWN attempt so the paper can be tested again and
// again. Strictly admin — students keep the one-attempt rule.
export async function resetMyPaperAttempt(sectionId: string): Promise<PaperAttempt> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "none" };
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return getMyPaperAttempt(sectionId);
  await supabase.from("descriptive_attempts").delete().eq("student_id", user.id).eq("section_id", sectionId);
  return { status: "none" };
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
  // The answer sheet lives in the private bucket now — resolve it to a signed
  // URL so the AI grader and the annotator can read it.
  const { resolveFileUrl } = await import("@/lib/storage");
  const studentUrl = await resolveFileUrl(row.file_url);
  let graded: DescriptiveGrade | null = null;
  try {
    if (cfg.solutionPdf && studentUrl) graded = await gradeDescriptivePaper(studentUrl, cfg.solutionPdf, cfg.totalMarks || row.total_marks || null);
  } catch {
    graded = null;
  }
  if (graded) {
    // Build the annotated "checked copy" (marks + margin notes) — best-effort.
    let annotatedUrl: string | null = null;
    try {
      if (studentUrl && (graded.annotations?.length ?? 0) > 0) {
        const bytes = await buildAnnotatedPdf(studentUrl, graded);
        if (bytes) {
          // The checked copy is personal too → private bucket.
          const path = `descriptive/${sectionId}/${row.id}-checked.pdf`;
          const up = await svc.storage.from("secure").upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
          if (!up.error) annotatedUrl = `secure:${path}`;
        }
      }
    } catch {
      annotatedUrl = null;
    }
    await svc.from("descriptive_attempts").update({ status: "graded", awarded_marks: graded.awarded, total_marks: graded.total, report: graded, annotated_url: annotatedUrl }).eq("id", row.id);
    return { status: "graded", fileUrl: row.file_url ?? undefined, annotatedUrl: annotatedUrl ?? undefined, submittedAt: row.submitted_at ?? undefined, deadlineAt: row.deadline_at, awarded: graded.awarded, total: graded.total, report: graded };
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
    if (user.email) {
      // The answer is private — give faculty a proxied link (needs their login)
      // instead of the useless raw "secure:" reference.
      const link = `https://caparveensharma.com/api/file?u=${encodeURIComponent(input.fileUrl)}`;
      await notifyFaculty("A descriptive paper was submitted", `Student: ${user.email}\nPaper: ${input.sectionId}\nUploaded answer (login required): ${link}`);
    }
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
