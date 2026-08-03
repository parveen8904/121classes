import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Create a descriptive topic test from TYPED questions.
//
// Every descriptive test on the site is built around an uploaded question-paper
// PDF, so a new test could only ever start with a file someone had already
// typed up elsewhere. This lays the questions out as a proper paper — heading,
// marks in the margin, instructions — writes it into the private bucket and
// creates the published test, so a topic test can be written in one go.
//
// Admin only. The answer key is NOT written here: the paper is queued for the
// drafter, and a key still has to be approved before it marks anybody.

type Q = { text: string; marks: number };

// Helvetica is WinAnsi — it cannot encode the rupee sign, and pdf-lib throws
// rather than dropping it. Papers say "Rs." so nothing fails at draw time.
function safe(s: string): string {
  return String(s ?? "")
    .replace(/₹/g, "Rs.")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    // Anything still outside WinAnsi would throw; drop it rather than fail.
    .replace(/[^\x20-\xFF\n]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = "";
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > maxW && line) { out.push(line); line = w; }
      else line = t;
    }
    if (line) out.push(line);
  }
  return out;
}

async function buildPaper(input: {
  course: string;
  subject: string;
  topic: string;
  title: string;
  minutes: number;
  total: number;
  instructions: string[];
  questions: Q[];
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const W = 595, H = 842, M = 56;
  const bodyW = W - M * 2 - 46; // leave a margin column for the marks
  let page = pdf.addPage([W, H]);
  let y = H - M;

  const line = (t: string, size: number, f: PDFFont, gap = 4, color = rgb(0.1, 0.1, 0.1)) => {
    for (const l of wrap(t, f, size, bodyW)) {
      if (y < M + 40) { page = pdf.addPage([W, H]); y = H - M; }
      page.drawText(l, { x: M, y, size, font: f, color });
      y -= size + gap;
    }
  };

  line(safe(`${input.course} — ${input.subject}`), 10, font, 2, rgb(0.35, 0.35, 0.35));
  line(safe(input.title), 16, bold, 6, rgb(0.05, 0.35, 0.4));
  line(safe(input.topic), 11, font, 10, rgb(0.35, 0.35, 0.35));

  page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 10;
  line(`Time allowed: ${input.minutes} minutes${" ".repeat(8)}Maximum marks: ${input.total}`, 11, bold, 8);

  for (const ins of input.instructions) line(`- ${ins}`, 9.5, font, 3, rgb(0.3, 0.3, 0.3));
  y -= 8;
  page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 14;

  input.questions.forEach((q, i) => {
    if (y < M + 90) { page = pdf.addPage([W, H]); y = H - M; }
    const head = `Question ${i + 1}`;
    page.drawText(head, { x: M, y, size: 12, font: bold, color: rgb(0.05, 0.35, 0.4) });
    page.drawText(`(${q.marks} Marks)`, { x: W - M - 62, y, size: 10, font: bold, color: rgb(0.3, 0.3, 0.3) });
    y -= 18;
    line(q.text, 10.5, font, 4);
    y -= 14;
  });

  if (y < M + 30) { page = pdf.addPage([W, H]); y = H - M; }
  page.drawText("*** End of the question paper ***", {
    x: M, y: Math.max(M, y - 6), size: 9, font, color: rgb(0.45, 0.45, 0.45),
  });

  return await pdf.save();
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "login required" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "admins only" }, { status: 403 });

  const body = (await req.json()) as {
    topicId?: string;
    title?: string;
    minutes?: number;
    instructions?: string[];
    questions?: Q[];
  };

  const topicId = String(body.topicId ?? "");
  const title = String(body.title ?? "").trim();
  const questions = (body.questions ?? []).filter((q) => q?.text && Number(q.marks) > 0);
  if (!topicId || !title || !questions.length) {
    return NextResponse.json({ error: "topicId, title and at least one question are required" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: topic } = await svc
    .from("topics")
    .select("id, title, subjects(title, courses(title))")
    .eq("id", topicId)
    .maybeSingle();
  if (!topic) return NextResponse.json({ error: "topic not found" }, { status: 404 });

  const subj = (topic as { subjects?: { title?: string; courses?: { title?: string } | null } | null }).subjects;
  const total = questions.reduce((s, q) => s + Number(q.marks), 0);
  const minutes = Number(body.minutes) || Math.max(30, total * 2);

  const bytes = await buildPaper({
    course: subj?.courses?.title ?? "",
    subject: subj?.title ?? "",
    topic: String(topic.title ?? ""),
    title,
    minutes,
    total,
    instructions: body.instructions ?? [
      "Answer ALL questions.",
      "Working notes form part of the answer and carry marks.",
      "Figures are in Rupees unless stated otherwise.",
    ],
    questions,
  });

  const path = `materials/topic-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
  const up = await svc.storage.from("secure").upload(path, Buffer.from(bytes), {
    contentType: "application/pdf",
    upsert: false,
  });
  if (up.error) return NextResponse.json({ error: `upload failed: ${up.error.message}` }, { status: 500 });

  // Put it after whatever is already in the topic.
  const { data: last } = await svc
    .from("sections")
    .select("order_index")
    .eq("topic_id", topicId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: section, error: secErr } = await svc
    .from("sections")
    .insert({
      topic_id: topicId,
      title,
      type: "subjective_test",
      is_published: true,
      order_index: Number(last?.order_index ?? 0) + 1,
      config: {
        paper_question_pdf: `secure:${path}`,
        paper_solution_pdf: null,
        paper_total_marks: total,
        paper_duration_minutes: minutes,
        paper_instructions: null,
      },
    })
    .select("id")
    .single();
  if (secErr || !section) {
    return NextResponse.json({ error: `could not create the test: ${secErr?.message}` }, { status: 500 });
  }

  // Queue its answer key — drafted and then approved on Admin → Answer keys.
  await svc.from("item_solutions").insert({ section_id: section.id, status: "queued" });

  return NextResponse.json({
    ok: true,
    sectionId: section.id,
    title,
    totalMarks: total,
    minutes,
    questionPaper: `secure:${path}`,
  });
}
