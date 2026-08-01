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
  await assertArea(null);
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
  await assertArea(null);
  const text = str(formData.get("text"));
  const on = formData.get("on") === "on";
  const { saveAutoReply } = await import("@/lib/whatsappAutoReply");
  await saveAutoReply(text, on);
  revalidatePath("/admin/whatsapp");
  redirect("/admin/whatsapp?saved=1");
}
