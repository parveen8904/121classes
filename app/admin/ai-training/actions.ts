"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const str = (v: unknown) => String(v ?? "").trim();

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

/* ═══════════════════════════════════════════════════════════════════════════
   THE FACULTY'S OWN DOCUMENTS
   ═══════════════════════════════════════════════════════════════════════════ */

export async function addKnowledgeAction(formData: FormData) {
  // A LONG DOCUMENT IS NOT A HOUSE RULE.
  //
  // The lessons above are one-liners, kept short deliberately. A revision
  // roadmap or an exam blueprint is teaching: it has to reach the student
  // quoted, with its stage names, its timings and its mark allocations intact.
  // So it is stored whole and put in front of the model only when the question
  // is about it.
  await requireAdmin();
  const title = str(formData.get("title"));
  const subject = str(formData.get("subject")) || null;
  const triggers = str(formData.get("triggers"))
    .split(/[,\n]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const file = formData.get("file") as File | null;
  if (!title || !file || !file.size) {
    redirect(`/admin/ai-training?err=${encodeURIComponent("A title and the document are both needed.")}`);
  }

  const svc = createServiceClient();
  const name = (file!.name || "document").toLowerCase();
  let body = "";

  if (name.endsWith(".pdf")) {
    // The PDF is filed first, then read — so the source stays available even if
    // the reading needs redoing later.
    const path = `ai-knowledge/${Date.now()}-${name.replace(/[^\w.\-]+/g, "_").slice(-70)}`;
    const up = await svc.storage.from("secure").upload(path, Buffer.from(await file!.arrayBuffer()), {
      contentType: "application/pdf", upsert: false,
    });
    if (up.error) redirect(`/admin/ai-training?err=${encodeURIComponent(up.error.message)}`);
    const { extractPdfText } = await import("@/lib/pdf");
    body = await extractPdfText(`secure:${path}`);
  } else {
    body = await file!.text();
  }

  body = body.trim();
  if (body.length < 200) {
    redirect(`/admin/ai-training?err=${encodeURIComponent(
      "Almost nothing could be read from that file — a scanned PDF has no text in it. Send a text or Word-exported PDF, or paste the text as a .md file.",
    )}`);
  }

  await svc.from("ai_knowledge").insert({
    title, subject, triggers, body,
    source_file: file!.name,
    priority: Number(formData.get("priority")) || 0,
  });
  revalidatePath("/admin/ai-training");
  redirect(`/admin/ai-training?ok=${encodeURIComponent(`"${title}" learned — ${body.length.toLocaleString("en-IN")} characters.`)}`);
}

export async function toggleKnowledgeAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData.get("id"));
  const active = str(formData.get("active")) === "1";
  if (!id) return;
  await createServiceClient().from("ai_knowledge")
    .update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/ai-training");
}

export async function deleteKnowledgeAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData.get("id"));
  if (!id) return;
  await createServiceClient().from("ai_knowledge").delete().eq("id", id);
  revalidatePath("/admin/ai-training");
}
