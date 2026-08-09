"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { sendWhatsAppText } from "@/lib/notify";
import { str } from "../_lib/util";

// Replies are free-form text, which WhatsApp only delivers inside the 24h
// window that opens when the student messages first. Outside it Meta silently
// drops the message, so the failure is surfaced rather than swallowed.
export async function replyOnWhatsApp(formData: FormData) {
  await assertArea("inbox");
  const to = str(formData.get("to"));
  const text = str(formData.get("text"));
  if (!to || !text) return;

  const ok = await sendWhatsAppText(to, text);

  const svc = createServiceClient();
  await svc.from("notifications").insert({
    student_id: null,
    channel: "whatsapp",
    template: "outbound",
    payload: { to, text },
    status: ok ? "sent" : "failed",
  });

  revalidatePath("/admin/whatsapp");
  redirect(`/admin/whatsapp?sent=${ok ? "1" : "0"}`);
}

// The instant acknowledgement every incoming message gets. Editable here so
// the wording is never buried in code.
export async function saveWhatsAppAutoReply(formData: FormData) {
  await assertArea("inbox");
  const text = str(formData.get("text"));
  const on = formData.get("on") === "on";
  const { saveAutoReply } = await import("@/lib/whatsappAutoReply");
  await saveAutoReply(text, on);
  revalidatePath("/admin/whatsapp");
  redirect("/admin/whatsapp?saved=1");
}

/**
 * Draft a reply to the newest student message in a thread — do not send it.
 *
 * The founder's number is the one students already use, and it stays on his
 * phone. So the AI must never speak on it: it prepares the answer from HIS OWN
 * repository, he reads it, and he presses send. This writes the draft into the
 * reply box; nothing leaves the account until he does.
 */
export async function draftWhatsAppReply(formData: FormData) {
  await assertArea("inbox");
  const to = str(formData.get("to"));
  const question = str(formData.get("question"));
  if (!to || !question) return;

  const svc = createServiceClient();
  try {
    const [{ getRepositoryContext }, ai] = await Promise.all([
      import("@/lib/repository"),
      import("@/lib/ai"),
    ]);
    const { answerDoubtFromMaterial, aiConfigured, judgeStudentMessage, NEED_FACULTY } = ai;
    if (!(await aiConfigured())) return;

    // Only a real question is worth drafting for. Chatter and abuse are left
    // for him to glance at and ignore.
    const judged = await judgeStudentMessage(question);
    if (judged.kind !== "question") {
      await svc.from("site_settings").upsert(
        { key: `wadraft:${to}`, value: "" },
        { onConflict: "key" },
      );
      revalidatePath("/admin/whatsapp");
      return;
    }

    const material = await getRepositoryContext(null, 24000, { query: question });
    const answer = await answerDoubtFromMaterial(question, material, "doubt", { betaNote: false });
    const text = answer && answer.trim() !== NEED_FACULTY ? answer.trim() : "";

    await svc.from("site_settings").upsert({ key: `wadraft:${to}`, value: text }, { onConflict: "key" });
  } catch {
    /* a failed draft simply leaves the box empty */
  }
  revalidatePath("/admin/whatsapp");
}

/**
 * Answer everyone still inside their 24-hour window.
 *
 * WhatsApp only lets a free-form reply through for 24 hours after the student
 * writes. Older conversations can be reached only with a Meta-approved
 * template, so they are left alone rather than half-answered — the founder's
 * instruction was to reply inside the window and ignore what came before.
 *
 * Each conversation is answered ONCE, on its newest message, through the same
 * path a live message takes: repository first, then a reply built from what the
 * site actually holds. Nobody is left with silence.
 */
export async function answerOpenConversations() {
  await assertArea("inbox");
  const svc = createServiceClient();

  const { data } = await svc
    .from("notifications")
    .select("payload")
    .eq("channel", "whatsapp")
    .eq("template", "inbound")
    .order("id", { ascending: false })
    .limit(400);

  // Newest message per sender, and only those still inside the window.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const newest = new Map<string, { at: number; text: string }>();
  for (const r of data ?? []) {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const from = String(p.from ?? "");
    const at = Number(p.timestamp ?? p.ts ?? 0) * 1000;
    const text = String((p.text as { body?: string } | undefined)?.body ?? "").trim();
    if (!from || !at || at < cutoff || !text) continue;
    const seen = newest.get(from);
    if (!seen || at > seen.at) newest.set(from, { at, text });
  }

  // Anyone we have already written to since their last message is left alone —
  // pressing this twice must not send the same student a second answer.
  const { data: sent } = await svc
    .from("notifications")
    .select("payload, sent_at")
    .eq("channel", "whatsapp")
    .eq("template", "outbound")
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(400);
  const { ABUSE_WARNING, ABUSE_WARNING_DIRECT } = await import("@/lib/ai");
  const repliedAt = new Map<string, number>();
  for (const r of sent ?? []) {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const to = String(p.to ?? "");
    const body = String((p.text as { body?: string } | undefined)?.body ?? "");
    // A telling-off is not an answer. A student who asked for the hit list was
    // warned instead of helped, and counting that as "already replied to" would
    // have left him with the warning and nothing else.
    if (body && (body === ABUSE_WARNING || body === ABUSE_WARNING_DIRECT)) continue;
    const when = new Date(String(r.sent_at)).getTime();
    if (to && when > (repliedAt.get(to) ?? 0)) repliedAt.set(to, when);
  }

  const { answerWhatsAppDoubt } = await import("@/lib/whatsappAnswer");
  let answered = 0;
  let skipped = 0;
  for (const [from, msg] of newest) {
    if ((repliedAt.get(from) ?? 0) > msg.at) { skipped++; continue; }
    try {
      const outcome = await answerWhatsAppDoubt(from, msg.text);
      if (outcome === "ignored") skipped++;
      else answered++;
    } catch {
      skipped++;
    }
  }

  revalidatePath("/admin/whatsapp");
  redirect(`/admin/whatsapp?answered=${answered}&left=${skipped}`);
}
