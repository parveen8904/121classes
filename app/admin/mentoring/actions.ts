"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireArea } from "@/lib/adminAccess";

// EVERY MENTORING TOUCH IS RECORDED, AND NOTHING SENDS BY ITSELF.
//
// The founder asked for one-to-one mentoring with approval on everything. So
// there is no cron here and no bulk send: a person opens the desk, reads one
// student's figures, and either rings them or edits the drafted message and
// sends it. What happened is written down, because the value of the record is
// that the next person sees "promised to resume on Monday" instead of starting
// the conversation again.

async function actor(): Promise<{ id: string | null; name: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { id: null, name: "staff" };
  const { data } = await createServiceClient()
    .from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
  return { id: user.id, name: String(data?.full_name ?? data?.email ?? "staff") };
}

/** Log a call or a note against a student. No message leaves the building. */
export async function logTouch(formData: FormData): Promise<void> {
  if (!(await requireArea("students"))) return;
  const studentId = String(formData.get("student_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const outcome = String(formData.get("outcome") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 2000);
  if (!studentId || !reason || !outcome) return;

  const me = await actor();
  await createServiceClient().from("mentor_touches").insert({
    student_id: studentId,
    reason,
    channel: outcome === "sent" ? "note" : "call",
    outcome,
    note: note || null,
    by_id: me.id,
    by_name: me.name,
  });
  revalidatePath("/admin/mentoring");
}

/**
 * Send the message a human has just read and approved.
 *
 * The text comes from the form, not from here — whoever pressed the button owns
 * the words. A drafted suggestion is offered on the page and can be rewritten or
 * thrown away before sending.
 */
export async function sendNudge(formData: FormData): Promise<void> {
  if (!(await requireArea("students"))) return;
  const studentId = String(formData.get("student_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const channel = String(formData.get("channel") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!studentId || !body || (channel !== "email" && channel !== "whatsapp")) return;

  const svc = createServiceClient();
  const { data: s } = await svc
    .from("profiles").select("full_name, email, phone").eq("id", studentId).maybeSingle();
  if (!s) return;

  const me = await actor();
  let delivered = false;
  let how = "";

  if (channel === "email" && s.email) {
    const { sendEmail, emailShell } = await import("@/lib/notify");
    const first = String(s.full_name ?? "").split(" ")[0] || "there";
    const html = emailShell(
      "A note from CA Parveen Sharma Classes",
      `<p>Dear ${first},</p>` +
      body.split("\n").filter(Boolean).map((l) => `<p>${l}</p>`).join("") +
      `<p style="margin-top:16px">If you would rather talk, reply to this email or call us on 98100 12674 &mdash; we would much rather hear from you than not.</p>`,
    );
    delivered = await sendEmail(String(s.email), "About your studies — CA Parveen Sharma Classes", html).catch(() => false);
    how = String(s.email);
  }

  if (channel === "whatsapp" && s.phone) {
    const { sendWhatsAppText } = await import("@/lib/notify");
    delivered = await sendWhatsAppText(String(s.phone), body).catch(() => false);
    how = String(s.phone);
  }

  await svc.from("mentor_touches").insert({
    student_id: studentId,
    reason: reason || "manual",
    channel: channel === "email" ? "email" : "whatsapp",
    // Marked honestly. A message logged as sent that never went is worse than no
    // log at all — the next person reads it and assumes the student was told.
    outcome: delivered ? "sent" : "unreachable",
    note: (delivered ? `Sent to ${how}:\n\n` : `NOT SENT (${how || "no address"}):\n\n`) + body,
    by_id: me.id,
    by_name: me.name,
  });

  revalidatePath("/admin/mentoring");
}
