import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notesToPdf } from "@/lib/pdf";

const LETTER = ["A", "B", "C", "D", "E", "F"];

// Downloadable QUESTION PAPER (no answers) for an MCQ test.
export async function GET(_req: Request, { params }: { params: { sectionId: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Login required", { status: 401 });

  // RLS gates access — null means the student can't access this test.
  const { data: section } = await supabase
    .from("sections")
    .select("id, title, type")
    .eq("id", params.sectionId)
    .maybeSingle();
  if (!section || section.type !== "mcq_test") return new NextResponse("Not found", { status: 404 });

  const svc = createServiceClient();
  const { data: qs } = await svc
    .from("mcq_questions")
    .select("question, options, order_index")
    .eq("section_id", section.id)
    .order("order_index");
  if (!qs || !qs.length) return new NextResponse("No questions", { status: 404 });

  const lines: string[] = [`Total questions: ${qs.length}`, ""];
  qs.forEach((q, i) => {
    lines.push(`# Q${i + 1}. ${q.question}`);
    ((q.options as string[]) ?? []).forEach((o, oi) => lines.push(`- (${LETTER[oi] ?? oi + 1}) ${o}`));
    lines.push("");
  });

  const bytes = await notesToPdf(`${section.title} — Question Paper`, lines.join("\n"));
  const filename = `${(section.title || "mcq").replace(/[^a-z0-9]+/gi, "-")}-questions.pdf`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
