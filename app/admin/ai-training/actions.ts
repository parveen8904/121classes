"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Teaching, not editing.
//
// A reply reworded by hand helps one student. A lesson written down here changes
// what the AI says to the next hundred, on every channel.

async function requireAdmin(): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/ai-training");
  const { data: me } = await createServiceClient()
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") redirect("/dashboard");
  return user.id;
}

/** A standing instruction, applied to every answer on its channel. */
export async function addRule(formData: FormData) {
  const by = await requireAdmin();
  const guidance = String(formData.get("guidance") ?? "").trim();
  const scope = String(formData.get("scope") ?? "all").trim() || "all";
  if (!guidance) redirect("/admin/ai-training?err=Write the rule first");

  await createServiceClient().from("ai_lessons").insert({
    kind: "rule", scope, guidance, created_by: by,
  });
  revalidatePath("/admin/ai-training");
  redirect("/admin/ai-training?saved=rule");
}

/**
 * "That answer was wrong — here is what it should have said."
 *
 * Recorded against the question that caused it, so it comes back when a similar
 * question does. This is the whole point: the correction has to survive the
 * conversation it came from.
 */
export async function addCorrection(formData: FormData) {
  const by = await requireAdmin();
  const guidance = String(formData.get("guidance") ?? "").trim();
  const trigger = String(formData.get("trigger") ?? "").trim();
  const wasAnswered = String(formData.get("was_answered") ?? "").trim() || null;
  const questionId = String(formData.get("question_id") ?? "").trim() || null;
  const scope = String(formData.get("scope") ?? "all").trim() || "all";
  const back = String(formData.get("back") ?? "/admin/ai-training");

  if (!guidance || !trigger) redirect(`${back}?err=Both the question and the correct answer are needed`);

  await createServiceClient().from("ai_lessons").insert({
    kind: "correction",
    scope,
    trigger,
    guidance,
    was_answered: wasAnswered,
    question_id: questionId,
    created_by: by,
  });
  revalidatePath("/admin/ai-training");
  revalidatePath("/admin/doubt-log");
  redirect(`${back}?taught=1`);
}

export async function setLessonActive(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  if (id) {
    await createServiceClient().from("ai_lessons")
      .update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  }
  revalidatePath("/admin/ai-training");
  redirect("/admin/ai-training?saved=1");
}

export async function deleteLesson(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (id) await createServiceClient().from("ai_lessons").delete().eq("id", id);
  revalidatePath("/admin/ai-training");
  redirect("/admin/ai-training?saved=deleted");
}

/**
 * Try a question against what has been taught, WITHOUT sending anything.
 *
 * Teaching you cannot test is guesswork — he should be able to type the question
 * that went wrong and see whether the lesson took, before a student finds out.
 */
export async function tryQuestion(formData: FormData) {
  await requireAdmin();
  const question = String(formData.get("question") ?? "").trim();
  const scope = String(formData.get("scope") ?? "doubt").trim() || "doubt";
  if (!question) redirect("/admin/ai-training?err=Type a question to try");

  const { lessonsFor } = await import("@/lib/aiLessons");
  const { answerDoubtFromMaterial, aiConfigured } = await import("@/lib/ai");
  const fired = await lessonsFor(question, scope);

  let answer = "AI is not configured — add the Anthropic key in Integrations.";
  if (await aiConfigured()) {
    const { getRepositoryContext } = await import("@/lib/repository");
    const material = await getRepositoryContext(null, 8000, { query: question });
    answer = (await answerDoubtFromMaterial(question, material, scope, { betaNote: false }))
      ?? "The AI declined to answer and would hand this to a person.";
  }

  const svc = createServiceClient();
  await svc.from("site_settings").upsert(
    {
      key: "ai_training_last_try",
      value: JSON.stringify({
        question,
        scope,
        answer,
        fired: fired.map((f) => ({ kind: f.kind, guidance: f.guidance })),
        at: new Date().toISOString(),
      }),
    },
    { onConflict: "key" },
  );

  revalidatePath("/admin/ai-training");
  redirect("/admin/ai-training?tried=1#try");
}
