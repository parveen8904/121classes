import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadPlanInput, applySetup, type PlanSetup } from "@/lib/planner/load";
import { generatePlan } from "@/lib/planner/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Download the student's study plan as a real PDF file.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/planner", req.url));

  const { data: planRow } = await supabase.from("study_plans").select("setup").eq("user_id", user.id).maybeSingle();
  const setup = planRow?.setup as PlanSetup | null;
  if (!setup?.subjectId) return NextResponse.redirect(new URL("/planner", req.url));

  try {
    const input = await loadPlanInput({ subjectId: setup.subjectId, startDate: setup.startDate, examDate: setup.examDate, doneClasses: setup.doneClasses });
    if (!input) return NextResponse.redirect(new URL("/planner", req.url));
    applySetup(input, setup);
    const plan = generatePlan(input);
    const { renderPlanPdf } = await import("@/lib/planner/pdf");
    const buf = await renderPlanPdf(plan, { subjectTitle: input.subjectTitle, examDate: setup.examDate });
    // Recorded for the admin report: who downloaded their plan as a PDF.
    await supabase.from("study_plans").update({ downloaded_at: new Date().toISOString() }).eq("user_id", user.id);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="study-plan.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.redirect(new URL("/planner?pdf=error", req.url));
  }
}
