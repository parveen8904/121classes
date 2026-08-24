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
  underReview?: boolean;
  examinerRemarks?: string | null;
  examinerName?: string | null;
};

type Row = {
  id: string;
  section_id: string;
  status: string;
  review_status?: string | null;
  examiner_remarks?: string | null;
  examiner_name?: string | null;
  started_at: string;
  deadline_at: string;
  submitted_at: string | null;
  file_url: string | null;
  annotated_url: string | null;
  awarded_marks: number | null;
  total_marks: number | null;
  report: DescriptiveGrade | null;
  /** Set when the paper is a MOCK, whose key lives in mock_papers. */
  mock_paper_id?: string | null;
  grade_tries?: number | null;
  grade_error?: string | null;
};

// ---- annotated "checked copy" builder (pdf-lib, server-side) ----

// Helvetica is a WinAnsi font and pdf-lib THROWS on any character outside it
// rather than dropping it. The marking notes are about money, so they are full
// of "₹" — and one rupee sign killed the entire checked copy, silently. Every
// piece of text drawn on the page goes through here first.
function winAnsi(text: string): string {
  return String(text ?? "")
    .replace(/₹/g, "Rs.")
    .replace(/[≈∼]/g, "~")
    .replace(/[–—]/g, "-")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[…]/g, "...")
    .replace(/[×✕]/g, "x")
    .replace(/[✓✔]/g, "(correct)")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x20-\xFF]/g, "");
}

function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = winAnsi(text).split(/\s+/).filter(Boolean);
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

// The answer keys arrive with markdown emphasis in them (**Working Note 5**).
// Drawn as-is, the asterisks appear on the page around every heading.
function stripEmphasis(text: string): string {
  return String(text ?? "").replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "");
}

// wrapText re-joins on single spaces, which is right for a sentence and fatal
// for a ledger: it flattens the indentation and the column padding that hold an
// ICAI format together. For the answer key and the marking guide the line is
// kept exactly as written, and only broken — at a character, never re-spaced —
// when it is genuinely too wide for the page.
function wrapMono(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const line = winAnsi(stripEmphasis(text)).replace(/\t/g, "    ").replace(/\s+$/, "");
  if (!line) return [""];
  if (font.widthOfTextAtSize(line, size) <= maxW) return [line];
  const perChar = font.widthOfTextAtSize("0", size) || size * 0.6;
  const max = Math.max(20, Math.floor(maxW / perChar));
  const out: string[] = [];
  for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max));
  return out;
}

const KIND_COLOR = {
  right: rgb(0.09, 0.6, 0.3),
  wrong: rgb(0.86, 0.15, 0.15),
  partial: rgb(0.85, 0.5, 0.05),
  tip: rgb(0.1, 0.4, 0.8),
} as const;

// Draw a small marking sign (tick / cross / dash / dot) at (x,y) on the page.
// Everything on the student's page is drawn at this scale. 1x was invisible on
// a phone; 3x swamped the handwriting underneath. 2x is the settled size —
// change this one number to resize every mark, note and label together.
const S = 2;

function drawSign(page: PDFPage, kind: keyof typeof KIND_COLOR, x: number, y: number) {
  const c = KIND_COLOR[kind];
  const t = 2.2 * S;
  if (kind === "wrong") {
    page.drawLine({ start: { x, y: y + 6 * S }, end: { x: x + 11 * S, y: y - 5 * S }, thickness: t, color: c });
    page.drawLine({ start: { x: x + 11 * S, y: y + 6 * S }, end: { x, y: y - 5 * S }, thickness: t, color: c });
  } else if (kind === "right") {
    page.drawLine({ start: { x, y }, end: { x: x + 4 * S, y: y - 5 * S }, thickness: t, color: c });
    page.drawLine({ start: { x: x + 4 * S, y: y - 5 * S }, end: { x: x + 13 * S, y: y + 8 * S }, thickness: t, color: c });
  } else if (kind === "partial") {
    page.drawLine({ start: { x, y: y + S }, end: { x: x + 12 * S, y: y + S }, thickness: t, color: c });
  } else {
    page.drawCircle({ x: x + 5 * S, y: y + S, size: 3.2 * S, color: c });
  }
}

const KIND_LABEL = { right: "Correct", wrong: "Wrong", partial: "Partial", tip: "Tip" } as const;

// Returns the student's pages with marking signs + margin notes, plus a final
// summary page. null if it can't be built (caller falls back to the plain copy).
export async function buildAnnotatedPdf(
  studentPdfUrl: string,
  grade: DescriptiveGrade,
  official?: { pdfUrl?: string | null; text?: string | null; scheme?: string | null },
): Promise<Uint8Array | null> {
  try {
    const res = await fetch(studentPdfUrl, { cache: "no-store" });
    if (!res.ok) {
      console.error("[checked_copy] cannot read the student's paper", res.status);
      return null;
    }
    const srcBytes = new Uint8Array(await res.arrayBuffer());
    const out = await PDFDocument.create();
    const font = await out.embedFont(StandardFonts.Helvetica);
    const fontB = await out.embedFont(StandardFonts.HelveticaBold);
    // The answer keys and the marking guide are written in ICAI's own layout,
    // with the figures aligned in columns by spaces. Drawn in Helvetica, where
    // a space is narrower than a digit, every ledger account collapsed into a
    // paragraph of numbers. A fixed-width font is the only thing that keeps a
    // Branch Stock Account looking like one.
    const mono = await out.embedFont(StandardFonts.Courier);
    const monoB = await out.embedFont(StandardFonts.CourierBold);
    // ignoreEncryption: phone scanner apps routinely stamp a PDF as encrypted
    // with an empty owner password. Without this, load() throws and the whole
    // checked copy is lost — which is exactly what happened: the marks and
    // eight annotations existed, and the student was shown only text.
    const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const pageCount = src.getPageCount();
    if (pageCount === 0) {
      console.error("[checked_copy] the student's PDF has no pages");
      return null;
    }
    // embedPdf(bytes) parses the file a SECOND time, internally, with pdf-lib's
    // default options — so it threw on an encrypted PDF even though the load
    // above was told to ignore encryption. That is why the checked copy still
    // came back empty after the first fix. Embed the pages of the document
    // already parsed instead of handing pdf-lib the raw bytes again.
    const embedded = await out.embedPages(src.getPages());

    const byPage = new Map<number, DescriptiveGrade["annotations"]>();
    for (const a of grade.annotations ?? []) {
      const p = Math.min(pageCount, Math.max(1, a.page));
      (byPage.get(p) ?? byPage.set(p, []).get(p)!).push(a);
    }

    const MARGIN = 230 * S;
    for (let i = 0; i < pageCount; i++) {
      const ep = embedded[i];
      const ow = ep.width;
      const oh = ep.height;
      const page = out.addPage([ow + MARGIN, oh]);
      page.drawPage(ep, { x: 0, y: 0, width: ow, height: oh });
      page.drawLine({ start: { x: ow, y: 0 }, end: { x: ow, y: oh }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
      // WHAT THIS MARGIN CAN HONESTLY CLAIM.
      //
      // It said "Checked by CA Parveen Sharma" on every annotated copy — but
      // this PDF is drawn at GRADING time, before any examiner has even claimed
      // it, and the marks on it are the AI's. Now that examiners are named, it
      // was also liable to put his name on a copy CA Piyush checked. The
      // examiner's name belongs on the release, where it is true: the results
      // page and the email both carry it. See lib/examinerName.ts.
      page.drawText(winAnsi("AI-checked copy - CA Parveen Sharma Classes"), { x: ow + 14 * S, y: oh - 22 * S, size: 9 * S, font: fontB, color: rgb(0.05, 0.58, 0.53) });
      const list = (byPage.get(i + 1) ?? []).slice().sort((a, b) => a.y - b.y);
      for (const a of list) {
        const yTop = oh - Math.min(0.97, Math.max(0.03, a.y)) * oh;
        drawSign(page, a.kind, ow - 26 * S, yTop);
        const cx = ow + 16 * S;
        let yy = yTop + 2 * S;
        page.drawText(winAnsi(KIND_LABEL[a.kind]), { x: cx, y: yy, size: 8 * S, font: fontB, color: KIND_COLOR[a.kind] });
        yy -= 11 * S;
        for (const line of wrapText(a.note, font, 8.5 * S, MARGIN - 28 * S)) {
          page.drawText(line, { x: cx, y: yy, size: 8.5 * S, font, color: rgb(0.15, 0.15, 0.15) });
          yy -= 10.5 * S;
        }
      }
    }

    // Summary page
    const sp = out.addPage([595, 842]);
    const { width: sw, height: sh } = sp.getSize();
    let y = sh - 50;
    const line = (t: string, size: number, f: PDFFont, color = rgb(0.1, 0.1, 0.1), x = 40) => {
      for (const l of wrapText(t, f, size, sw - 80 - (x - 40))) {
        sp.drawText(winAnsi(l), { x, y, size, font: f, color });
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
    // ---- the official answers, bound into the same file ----
    // A student reading their marks wants the model answer beside them, not on
    // another screen. Best-effort: a failure here must never cost the marking.
    try {
      if (official?.pdfUrl) {
        const solRes = await fetch(official.pdfUrl, { cache: "no-store" });
        if (solRes.ok) {
          const solBytes = new Uint8Array(await solRes.arrayBuffer());
          if (solBytes.byteLength < 20 * 1024 * 1024) {
            const solDoc = await PDFDocument.load(solBytes, { ignoreEncryption: true });
            const divider = out.addPage([595, 842]);
            divider.drawText(winAnsi("Official answers"), {
              x: 40, y: 780, size: 20, font: fontB, color: rgb(0.05, 0.58, 0.53),
            });
            divider.drawText(winAnsi("Compare your answers above with these."), {
              x: 40, y: 752, size: 11, font, color: rgb(0.3, 0.3, 0.3),
            });
            // THE ERRATA AT THE BACK IS NOT PART OF THE ANSWER.
            //
            // His printed answer keys finish with a page or two of errata —
            // corrections to the booklet, meant for him and his printer. Bound
            // into a student's checked copy they read as more model answer, and
            // a student comparing their working against them is being sent
            // wrong. Counted from the BACK and stopping at the first page that
            // is not errata, so an "errata" mentioned inside a worked solution
            // cannot take a page of real answers with it.
            let keep = solDoc.getPages();
            try {
              const { extractPdfPageTexts, trailingErrataPages } = await import("@/lib/pdf");
              const drop = trailingErrataPages(await extractPdfPageTexts(official.pdfUrl));
              if (drop > 0 && drop < keep.length) {
                console.error(`[checked_copy] dropping ${drop} errata page(s) from the official answers`);
                keep = keep.slice(0, keep.length - drop);
              }
            } catch { /* if the text cannot be read, bind the key as it is */ }

            const solPages = await out.embedPages(keep);
            for (const sp2 of solPages) {
              const pg = out.addPage([sp2.width, sp2.height]);
              pg.drawPage(sp2, { x: 0, y: 0, width: sp2.width, height: sp2.height });
            }
          }
        }
      } else if (official?.text && official.text.trim()) {
        // The approved typeset key — laid out as readable pages.
        let page2 = out.addPage([595, 842]);
        let yy = 842 - 50;
        page2.drawText(winAnsi("Official answers"), {
          x: 40, y: yy, size: 20, font: fontB, color: rgb(0.05, 0.58, 0.53),
        });
        yy -= 30;
        // 8.5pt Courier is 5.1pt a character, so 100 characters fit across the
        // page — wide enough that a two-sided account is not broken up.
        for (const raw of official.text.split("\n")) {
          const bold = /^\s*(QUESTION|Q\d|ANSWER|Working Note|WORKING)/i.test(raw);
          for (const l of wrapMono(raw, bold ? monoB : mono, 8.5, 515)) {
            if (yy < 50) { page2 = out.addPage([595, 842]); yy = 842 - 50; }
            page2.drawText(l, { x: 40, y: yy, size: 8.5, font: bold ? monoB : mono, color: rgb(0.1, 0.1, 0.1) });
            yy -= 12;
          }
          if (!raw.trim()) yy -= 5;
        }
      }
    } catch (e) {
      console.error("[checked_copy] official answers could not be attached", e instanceof Error ? e.message : e);
    }

    // ---- the step marking guide ----
    // So a student can see exactly which step earned which mark, and argue
    // with it if they think it is wrong.
    try {
      if (official?.scheme && official.scheme.trim()) {
        let gp = out.addPage([595, 842]);
        let gy = 842 - 50;
        gp.drawText(winAnsi("How the marks were awarded"), {
          x: 40, y: gy, size: 20, font: fontB, color: rgb(0.05, 0.58, 0.53),
        });
        gy -= 22;
        gp.drawText(winAnsi("The same step-by-step scheme is used for every student on this test."), {
          x: 40, y: gy, size: 10, font, color: rgb(0.35, 0.35, 0.35),
        });
        gy -= 26;
        for (const raw of official.scheme.split("\n")) {
          const bold = /^\s*(QUESTION|Q\s*\d|Total|TOTAL)/i.test(raw);
          for (const l of wrapMono(raw, bold ? monoB : mono, 8.5, 515)) {
            if (gy < 50) { gp = out.addPage([595, 842]); gy = 842 - 50; }
            gp.drawText(l, { x: 40, y: gy, size: 8.5, font: bold ? monoB : mono, color: rgb(0.1, 0.1, 0.1) });
            gy -= 12;
          }
          if (!raw.trim()) gy -= 5;
        }
      }
    } catch (e) {
      console.error("[checked_copy] marking guide could not be attached", e instanceof Error ? e.message : e);
    }

    return await out.save();
  } catch (e) {
    // Silence here cost the founder a checked copy on his own test paper.
    console.error("[checked_copy] could not build", e instanceof Error ? e.message : e);
    return null;
  }
}

async function paperCfg(sectionId: string) {
  const { data } = await createServiceClient().from("sections").select("title, config").eq("id", sectionId).maybeSingle();
  const c = (data?.config ?? {}) as Record<string, unknown>;
  return {
    title: String((data as { title?: string } | null)?.title ?? "Descriptive test"),
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
  // AI has graded it, but the EXAMINER hasn't released it yet → the student
  // sees it as still under evaluation (no marks, no report, no checked copy).
  if (row.status === "graded" && row.review_status && row.review_status !== "checked") {
    return {
      status: "submitted",
      startedAt: row.started_at,
      deadlineAt: row.deadline_at,
      submittedAt: row.submitted_at ?? undefined,
      fileUrl: row.file_url ?? undefined,
      total: row.total_marks,
      underReview: true,
    };
  }
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
    examinerRemarks: row.examiner_remarks ?? null,
    examinerName: row.examiner_name ?? null,
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
  const svc = createServiceClient();
  let mockKey: string | null = null;
  let mockTitle = "Mock test paper";
  let mockTotal = 100;

  // A MOCK paper goes through this same function, deliberately.
  //
  // Its key is the suggested answers in mock_papers rather than an approved key
  // in item_solutions, and that is the only difference — same marking guide
  // built the same way, same examiner, same annotated copy, same release. Two
  // pipelines would have meant two standards, and the first student to submit
  // one of each would have found it.
  if (row.mock_paper_id) {
    const { data: mock } = await svc
      .from("mock_papers")
      .select("title, answers_md, total_marks")
      .eq("id", row.mock_paper_id)
      .maybeSingle();
    const key = String(mock?.answers_md ?? "").trim();
    if (!key) {
      // WAITING FOR A KEY IS NOT A FAILED ATTEMPT.
      //
      // grade_tries exists to stop a copy that cannot be marked from re-running
      // two AI calls every five minutes for ever. A missing answer key is not
      // that: nothing is being spent, nothing is wrong with the paper, and the
      // moment the key is uploaded it would mark perfectly.
      //
      // Counting it burned all three retries in the eight minutes between a
      // paper being sent for mock test 1 and its key being read back out of the
      // PDF. The copy was then dead for good, with the key sitting right there.
      // So the reason is recorded and the count is left alone.
      console.error("[grade] mock paper has no answers yet", row.mock_paper_id);
      await svc.from("descriptive_attempts").update({
        grade_error: "waiting for the answer key for this mock paper — it will mark itself as soon as the key is uploaded",
      }).eq("id", row.id);
      return { status: "submitted", fileUrl: row.file_url ?? undefined, submittedAt: row.submitted_at ?? undefined, deadlineAt: row.deadline_at, total: row.total_marks };
    }
    mockKey = key;
    mockTitle = String(mock?.title ?? "Mock test paper");
    mockTotal = Number(mock?.total_marks) || 100;
  }

  const cfg = mockKey
    ? { title: mockTitle, totalMarks: mockTotal, solutionPdf: "", questionPdf: "" }
    : await paperCfg(sectionId);
  // The answer sheet lives in the private bucket now — resolve it to a signed
  // URL so the AI grader and the annotator can read it.
  const { resolveFileUrl } = await import("@/lib/storage");
  const studentUrl = await resolveFileUrl(row.file_url);
  // The SOLUTION must be resolved too. Every descriptive test stores its answer
  // key as "secure:<path>"; handing that string straight to the grader made it
  // fetch a non-URL, which throws, and the paper came back ungraded every single
  // time. Nothing surfaced because the failure was swallowed.
  const solutionUrl = await resolveFileUrl(cfg.solutionPdf);

  // 37 of the descriptive tests have no solution PDF at all. For those, the
  // answer key is the one CA Parveen Sharma has APPROVED on Admin → Answer
  // keys. An unapproved draft is never used to mark anybody's paper.
  let approvedKey: string | null = mockKey;
  if (!solutionUrl && !approvedKey) {
    const { data: k } = await svc
      .from("item_solutions")
      .select("solution_md, status")
      .eq("section_id", sectionId)
      .maybeSingle();
    if (k?.status === "approved" && String(k.solution_md ?? "").trim()) {
      approvedKey = String(k.solution_md);
    }
  }

  // ---- the marking scheme: worked out once, reused for every student ----
  // Re-deriving the mark breakdown on every submission cost a full solution
  // PDF each time AND let the same paper score differently. The scheme is
  // built on the first copy marked and every copy after is marked against it.
  let scheme: string | null = null;
  try {
    const { data: saved } = await svc
      .from("marking_schemes")
      .select("scheme")
      .eq("section_id", row.mock_paper_id ?? sectionId)
      .maybeSingle();
    scheme = saved?.scheme ? String(saved.scheme) : null;

    if (!scheme && (solutionUrl || approvedKey)) {
      const { buildMarkingScheme } = await import("@/lib/ai");
      const built = await buildMarkingScheme({
        paperTitle: String(cfg.title ?? "Descriptive test"),
        totalMarks: cfg.totalMarks || row.total_marks || null,
        solutionPdfUrl: solutionUrl || null,
        solutionText: approvedKey,
      });
      if (built) {
        scheme = built;
        await svc.from("marking_schemes").upsert({
          // A mock paper's guide is keyed by the mock's id — same table, and
          // the same "build once, reuse for every student" rule.
          section_id: row.mock_paper_id ?? sectionId,
          scheme: built,
          total_marks: cfg.totalMarks || row.total_marks || null,
          built_from: solutionUrl ? "solution_pdf" : "approved_key",
        });
      }
    }
  } catch (e) {
    console.error("[marking_scheme] could not be prepared", e instanceof Error ? e.message : e);
  }

  let graded: DescriptiveGrade | null = null;
  try {
    const { gradeDescriptivePaperAgainstText } = await import("@/lib/ai");
    if (scheme && studentUrl) {
      // Only the answer book and a compact scheme travel to the marker.
      graded = await gradeDescriptivePaperAgainstText(studentUrl, scheme, cfg.totalMarks || row.total_marks || null);
    } else if (solutionUrl && studentUrl) {
      graded = await gradeDescriptivePaper(studentUrl, solutionUrl, cfg.totalMarks || row.total_marks || null);
    } else if (approvedKey && studentUrl) {
      graded = await gradeDescriptivePaperAgainstText(studentUrl, approvedKey, cfg.totalMarks || row.total_marks || null);
    }
  } catch (e) {
    console.error("[grade] marking threw for attempt", row.id, e instanceof Error ? e.message : e);
    graded = null;
  }
  if (!graded) {
    // Why this paper produced nothing, on the record. Without it the cron just
    // marks the same copy again every five minutes, paying each time, and the
    // examiner sees "AI check pending" for ever with nothing to explain it.
    console.error(
      "[grade] no report for attempt", row.id,
      "scheme:", scheme ? "yes" : "no",
      "solutionPdf:", solutionUrl ? "yes" : "no",
      "approvedKey:", approvedKey ? "yes" : "no",
      "studentUrl:", studentUrl ? "yes" : "no",
    );
    await svc
      .from("descriptive_attempts")
      .update({
        grade_tries: (Number(row.grade_tries) || 0) + 1,
        grade_error: !studentUrl
          ? "the answer book could not be opened"
          : !(scheme || solutionUrl || approvedKey)
            ? "this test has no approved answer key to mark against"
            : "the marking reply could not be read",
      })
      .eq("id", row.id);
  }
  if (graded) {
    // Build the annotated "checked copy" (marks + margin notes) — best-effort.
    let annotatedUrl: string | null = null;
    try {
      // NO NOTES CAME BACK? ASK FOR THEM ON THEIR OWN.
      //
      // The marking call returns marks and margin notes together, and on a big
      // paper it spends its reply on the marks — mock paper 1 marked 26
      // questions and returned not one note, so the copy had a margin and
      // nothing in it. A second small call, with the marks already decided and
      // handed to it, fills them in without touching a figure.
      if (!(graded.annotations?.length ?? 0) && studentUrl) {
        try {
          const src = await fetch(studentUrl, { cache: "no-store" });
          if (src.ok) {
            const b64 = Buffer.from(await src.arrayBuffer()).toString("base64");
            const { marginNotesForPaper } = await import("@/lib/ai");
            const notes = await marginNotesForPaper(b64, graded);
            if (notes.length) {
              graded.annotations = notes;
              console.error(`[checked_copy] ${notes.length} margin note(s) fetched separately for attempt`, row.id);
            }
          }
        } catch (e) {
          console.error("[checked_copy] margin notes could not be fetched", e instanceof Error ? e.message : e);
        }
      }

      // THE MARGIN NOTES ARE ONE PART OF THE CHECKED COPY, NOT ALL OF IT.
      //
      // This used to build the copy only when there were annotations to draw,
      // so a paper with none got nothing at all — no pages, no summary sheet,
      // and not the official answers either, which is the part students
      // actually study from. Mock paper 1 marked 26 questions at 69/100 and
      // produced no annotations: with 26 questions to mark the model spent its
      // reply on the marks. The copy was silently skipped, and because the
      // "could not draw it" branch never ran, nothing was recorded to say why.
      //
      // So it is built whenever there is a marked report and a paper to draw
      // on. Fewer margin notes is a thinner copy; no copy is a student left
      // with a number and no working.
      if (studentUrl) {
        // The student's copy carries their marked pages, the summary and the
        // OFFICIAL ANSWERS — never the step marking guide. That is an
        // examiner's working document and it stays on the examiner's screen.
        const bytes = await buildAnnotatedPdf(studentUrl, graded, {
          pdfUrl: solutionUrl || null,
          text: approvedKey,
        });
        // Worth knowing on the record, so an examiner reading a copy with no
        // ticks in the margin knows it is not their eyesight.
        if (!(graded.annotations?.length ?? 0)) {
          (graded as unknown as Record<string, unknown>).checked_copy_note =
            "no margin notes came back for this paper — the copy carries the marks, the summary and the official answers";
        }
        if (!bytes) {
          console.error("[checked_copy] no annotated PDF produced for attempt", row.id);
          // Say so on the record too — a silent failure here cost two rounds of
          // "the checked copy is missing again".
          (graded as unknown as Record<string, unknown>).checked_copy_error =
            "the answer PDF could not be re-drawn (unreadable or protected file)";
        }
        if (bytes) {
          // The checked copy is personal too → private bucket.
          const path = `descriptive/${sectionId}/${row.id}-checked.pdf`;
          const up = await svc.storage.from("secure").upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
          if (!up.error) annotatedUrl = `secure:${path}`;
        }
      }
    } catch (e) {
      console.error("[checked_copy] upload failed", e instanceof Error ? e.message : e);
      annotatedUrl = null;
    }
    // A MARK OF NOTHING, WITH NO QUESTION MARKED, IS NOT A RESULT.
    //
    // Mock paper 1 came back with a summary any examiner would recognise as
    // real work — "strong attempt across most questions; good grasp of AS 7,
    // AS 21, AS 26, AS 29 and AS 13; weaker on AS 16" — and an EMPTY
    // per_question list. The total is arithmetic on that list, so a paper the
    // marker plainly thought was good was recorded as 0 out of 100.
    //
    // The student would have opened that. So an empty breakdown is treated as
    // a failed pass, not as a zero: the copy stays "submitted", the reason is
    // written down, and it is retried and then handed to a person. A real zero
    // — a blank or wholly wrong paper — still has questions listed against it,
    // which is how the two are told apart.
    if (!graded.per_question?.length) {
      console.error("[grade] refusing a 0 with no per-question marks for attempt", row.id);
      await svc.from("descriptive_attempts").update({
        grade_tries: (Number(row.grade_tries) || 0) + 1,
        grade_error: "the marking came back with no per-question marks — not recorded, so nobody is shown a wrong zero",
      }).eq("id", row.id);
      return { status: "submitted", fileUrl: row.file_url ?? undefined, submittedAt: row.submitted_at ?? undefined, deadlineAt: row.deadline_at, total: row.total_marks };
    }

    const { error: saveErr } = await svc
      .from("descriptive_attempts")
      .update({ status: "graded", awarded_marks: graded.awarded, total_marks: graded.total, report: graded, annotated_url: annotatedUrl, review_status: "pending", grade_error: null })
      .eq("id", row.id);
    // The marking is only done when it is SAVED. An ignored error here looked
    // exactly like a paper that was never marked at all.
    if (saveErr) console.error("[grade] report could not be saved for attempt", row.id, saveErr.message);
    // The student does NOT get the report yet — an examiner verifies first.
    return { status: "submitted", fileUrl: row.file_url ?? undefined, submittedAt: row.submitted_at ?? undefined, deadlineAt: row.deadline_at, total: graded.total, underReview: true };
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

  // Record the submission and RETURN. Marking does not happen here.
  //
  // This action used to run the whole pipeline while the student watched: the
  // already-marked scan, building the marking scheme, the grading call, then
  // drawing the annotated copy — minutes of AI work on a 2 MB upload. It was
  // slow for every student and it timed out, which is how one paper reached
  // the examiner with no marks at all. Grading now runs on its own, a few
  // minutes later, exactly as the screen tells the student it will.
  const submittedAt = new Date().toISOString();
  await createServiceClient()
    .from("descriptive_attempts")
    .update({
      file_url: input.fileUrl,
      submitted_at: submittedAt,
      status: "submitted",
      // Waiting for a person from the moment it arrives. It used to inherit
      // the column default of "checked", so a copy the AI could not grade was
      // born looking already-verified and never reached the examiner desk.
      review_status: "pending",
    })
    .eq("id", r.id);

  // Start the marking NOW, in the background, instead of waiting for the next
  // sweep of the cron. The student's page still returns immediately — waitUntil
  // keeps the function alive after the response has gone — but the checked copy
  // is ready in about a minute rather than up to six. The cron stays as the
  // safety net for anything this misses.
  try {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(
      gradeSubmittedPaper(r.id).catch((e) =>
        console.error("[grade] immediate marking failed for attempt", r.id, e instanceof Error ? e.message : e),
      ),
    );
  } catch { /* not on Vercel — the cron will pick it up */ }

  try {
    if (user.email) {
      const link = `https://caparveensharma.com/api/file?u=${encodeURIComponent(input.fileUrl)}`;
      await notifyFaculty("A descriptive paper was submitted", `Student: ${user.email}\nPaper: ${input.sectionId}\nUploaded answer (login required): ${link}`);
    }
  } catch { /* non-blocking */ }

  return { ...toAttempt(r), status: "submitted", submittedAt, fileUrl: input.fileUrl, underReview: true };

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

// Rebuild the checked copy for an attempt that was graded before the annotated
// PDF could be produced. The marking is already stored — the eight annotations
// on the founder's own Branch paper existed all along — so nothing is re-marked
// and no AI call is made; the copy is simply drawn from what is on record.
export async function rebuildCheckedCopy(sectionId: string): Promise<PaperAttempt> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "none" };
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return getMyPaperAttempt(sectionId);

  const svc = createServiceClient();
  const { data: row } = await svc
    .from("descriptive_attempts")
    .select("*")
    .eq("student_id", user.id)
    .eq("section_id", sectionId)
    .maybeSingle();
  const r = row as Row | null;
  if (!r?.file_url || !r.report) return toAttempt(r);

  const { resolveFileUrl } = await import("@/lib/storage");
  const studentUrl = await resolveFileUrl(r.file_url);
  if (!studentUrl) return toAttempt(r);

  // The same official answers a fresh submission would get: the solution PDF
  // if the test has one, otherwise the key CA Parveen Sharma has approved.
  const cfg = await paperCfg(sectionId);
  const officialPdf = await resolveFileUrl(cfg.solutionPdf, 900);
  let officialText: string | null = null;
  if (!officialPdf) {
    const { data: k } = await svc
      .from("item_solutions")
      .select("solution_md, status")
      .eq("section_id", sectionId)
      .maybeSingle();
    if (k?.status === "approved") officialText = String(k.solution_md ?? "") || null;
  }

  const bytes = await buildAnnotatedPdf(studentUrl, r.report as DescriptiveGrade, {
    pdfUrl: officialPdf || null,
    text: officialText,
  });
  if (!bytes) return toAttempt(r);

  const path = `descriptive/${sectionId}/${r.id}-checked.pdf`;
  const up = await svc.storage.from("secure").upload(path, Buffer.from(bytes), {
    contentType: "application/pdf",
    upsert: true,
  });
  if (up.error) return toAttempt(r);

  await svc
    .from("descriptive_attempts")
    .update({ annotated_url: `secure:${path}` })
    .eq("id", r.id);

  const { data: after } = await svc.from("descriptive_attempts").select("*").eq("id", r.id).maybeSingle();
  return toAttempt(after as Row | null);
}

/**
 * Mark one submitted paper. Called by the grading worker, not by a student —
 * it takes an attempt id and never touches the session, so it can run minutes
 * after the student has closed the page.
 */
export async function gradeSubmittedPaper(attemptId: string): Promise<{ graded: boolean; reason?: string }> {
  const svc = createServiceClient();
  const { data: row } = await svc.from("descriptive_attempts").select("*").eq("id", attemptId).maybeSingle();
  const r = row as Row | null;
  if (!r) return { graded: false, reason: "attempt not found" };
  if (!r.file_url) return { graded: false, reason: "no answer book" };
  if (r.report) return { graded: false, reason: "already marked" };

  // The already-marked check moved here too: it is advisory, and a student
  // should never wait on it.
  try {
    const { resolveFileUrl: resolveForCheck } = await import("@/lib/storage");
    const checkUrl = await resolveForCheck(r.file_url, 600);
    if (checkUrl) {
      const { looksAlreadyChecked } = await import("@/lib/ai");
      if (await looksAlreadyChecked(checkUrl)) {
        await svc
          .from("descriptive_attempts")
          .update({ review_flag: "may_already_be_marked" })
          .eq("id", r.id);
      }
    }
  } catch { /* advisory only */ }

  const out = await gradeAndStore(r, r.section_id as string);
  return { graded: out.status === "submitted" && out.underReview === true, reason: out.underReview ? undefined : "grading produced no report" };
}
