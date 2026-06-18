"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { aiConfigured, suggestedAnswer } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";

// On-demand model answer for a subjective question (so we don't spend tokens
// unless the student asks). Grounded in the subject's repository material.
export async function getSuggestedAnswer(questionId: string): Promise<{ ok: boolean; answer?: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !questionId) return { ok: false };
  if (!(await aiConfigured())) return { ok: false };

  const svc = createServiceClient();
  const { data: q } = await svc
    .from("subjective_questions")
    .select("prompt, max_marks, section_id")
    .eq("id", questionId)
    .maybeSingle();
  if (!q) return { ok: false };

  let subjectId: string | null = null;
  if (q.section_id) {
    const { data: sec } = await svc.from("sections").select("topics(subject_id)").eq("id", q.section_id).maybeSingle();
    subjectId = (sec as { topics?: { subject_id?: string } | null } | null)?.topics?.subject_id ?? null;
  }
  const material = await getRepositoryContext(subjectId, 12000);
  const answer = await suggestedAnswer(q.prompt, q.max_marks ?? 10, material);
  return answer ? { ok: true, answer } : { ok: false };
}
