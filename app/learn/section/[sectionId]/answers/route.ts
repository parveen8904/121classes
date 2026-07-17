import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notesToPdf } from "@/lib/pdf";
import { getMcqExplanations } from "@/lib/answers";

const LETTER = ["A", "B", "C", "D", "E", "F"];

// Downloadable ANSWER KEY (correct answers + explanations). Only the admin/faculty
// or a student who has ALREADY attempted the test may download it — so it can't be
// used to cheat before taking the test.
export async function GET(_req: Request, props: { params: Promise<{ sectionId: string }> }) {
  const params = await props.params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Login required", { status: 401 });

  const { data: section } = await supabase
    .from("sections")
    .select("id, title, type")
    .eq("id", params.sectionId)
    .maybeSingle();
  if (!section || section.type !== "mcq_test") return new NextResponse("Not found", { status: 404 });

  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isStaff = prof?.role === "admin" || prof?.role === "faculty";
  if (!isStaff) {
    const { count } = await supabase
      .from("mcq_attempts")
      .select("id", { count: "exact", head: true })
      .eq("student_id", user.id)
      .eq("section_id", section.id);
    if (!count) return new NextResponse("Take the test first to unlock the answer key.", { status: 403 });
  }

  const svc = createServiceClient();
  const { data: qs } = await svc
    .from("mcq_questions")
    .select("id, question, options, correct_index, concept, source_class_no, order_index")
    .eq("section_id", section.id)
    .order("order_index");
  if (!qs || !qs.length) return new NextResponse("No questions", { status: 404 });

  const explain = await getMcqExplanations(qs.map((q) => q.id));

  const lines: string[] = [];
  qs.forEach((q, i) => {
    const opts = (q.options as string[]) ?? [];
    const ex = explain.get(q.id);
    const tags = [q.source_class_no ? `Class ${q.source_class_no}` : "", q.concept ?? ""].filter(Boolean).join(" · ");
    lines.push(`# Q${i + 1}. ${q.question}${tags ? `  (${tags})` : ""}`);
    opts.forEach((o, oi) => {
      const mark = oi === q.correct_index ? " ✓ CORRECT" : "";
      const why = ex?.ww?.[oi] ? ` — ${ex.ww[oi]}` : "";
      lines.push(`- (${LETTER[oi] ?? oi + 1}) ${o}${mark}${why}`);
    });
    lines.push(`Answer: (${LETTER[q.correct_index] ?? q.correct_index + 1}) ${opts[q.correct_index] ?? ""}`);
    if (ex?.wc) lines.push(`Why: ${ex.wc}`);
    lines.push("");
  });

  const bytes = await notesToPdf(`${section.title} — Answer Key & Explanations`, lines.join("\n"));
  const filename = `${(section.title || "mcq").replace(/[^a-z0-9]+/gi, "-")}-answers.pdf`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
