import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildMockPaperPdf } from "@/lib/mockPaperPdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The question paper as a printable PDF.
//
// A mock test is sat on paper, so the paper has to look like one — a centred
// masthead, the marks at the right margin, part headings a student can find by
// flicking, page numbers. Reading it as a block of text on a web page is not
// sitting an exam.
//
// Login required: the whole offer is "write it and send it back to be checked",
// and the checked copy has to come back to somebody.
export async function GET(req: NextRequest, ctx: { params: Promise<{ paperId: string }> }) {
  const { paperId } = await ctx.params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL(`/login?next=/mock-tests?paper=${paperId}`, req.url));
  }

  const svc = createServiceClient();
  const { data: paper } = await svc
    .from("mock_papers")
    .select("title, questions_md, status")
    .eq("id", paperId)
    .maybeSingle();

  // Only an APPROVED paper is ever served — a draft is not for students.
  if (!paper || paper.status !== "approved" || !String(paper.questions_md ?? "").trim()) {
    return new NextResponse("Not available", { status: 404 });
  }

  const bytes = await buildMockPaperPdf({
    title: String(paper.title),
    text: String(paper.questions_md),
    footer: "caparveensharma.com — write your answers by hand, then send them in to be checked",
  });

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${String(paper.title).replace(/[^\w.\- ]/g, "").slice(0, 80)}.pdf"`,
      "cache-control": "private, max-age=300",
    },
  });
}
