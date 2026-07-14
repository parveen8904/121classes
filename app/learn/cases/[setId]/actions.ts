"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ensureCaseExplanations } from "@/lib/caseStudies";

// Grade a student's answers to one case study: score against the PDF's correct
// answers, make sure the AI explanations exist (generated once, then cached for
// every future student), save the attempt, and show the results view.
export async function submitCaseAttempt(formData: FormData) {
  const setId = String(formData.get("setId") ?? "");
  const caseId = String(formData.get("caseId") ?? "");
  if (!setId || !caseId) return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/learn/cases/${setId}/${caseId}`);

  const svc = createServiceClient();
  const { data: qs } = await svc
    .from("case_questions")
    .select("id, correct_index")
    .eq("case_id", caseId)
    .order("seq");
  const list = (qs ?? []) as { id: string; correct_index: number }[];
  if (!list.length) return;

  const answers: Record<string, number> = {};
  let score = 0;
  for (const q of list) {
    const v = formData.get(`q_${q.id}`);
    const picked = v === null ? -1 : Number(v);
    answers[q.id] = picked;
    if (picked === q.correct_index) score++;
  }

  // Explanations are generated on the FIRST submission of this case and cached.
  try { await ensureCaseExplanations(caseId); } catch { /* show answers without reasons */ }

  const { data: attempt } = await svc
    .from("case_attempts")
    .insert({ case_id: caseId, student_id: user.id, answers, score, total: list.length })
    .select("id")
    .single();

  redirect(`/learn/cases/${setId}/${caseId}?attempt=${attempt?.id ?? ""}`);
}
