import { createServiceClient } from "@/lib/supabase/service";
import { sendWhatsAppText } from "@/lib/notify";

// The instant reply every incoming WhatsApp message gets.
//
// A student who messages the business number should never sit in silence:
// one automatic acknowledgement goes out immediately, then a human answers
// from Admin → WhatsApp inbox. The wording is editable there, so it is never
// hard-coded in the site.
//
// Sent at most ONCE PER SENDER PER WINDOW — WhatsApp charges for messages and
// nobody wants a robot answering every line of a five-line conversation.

const TEXT_KEY = "wa_autoreply_text";
const ON_KEY = "wa_autoreply_on";
const WINDOW_HOURS = 12;

export const DEFAULT_AUTO_REPLY =
  "Thank you for writing to CA Parveen Sharma Classes 🙏\n\n" +
  "We have received your message and our team will reply personally during working hours (10 am to 7 pm, Monday to Saturday).\n\n" +
  "Meanwhile you may find what you need at caparveensharma.com — course details, the free study planner, free chapter tests and your dashboard.\n\n" +
  "If this is about a course you have already bought, please mention your registered email so we can check it faster.";

export async function getAutoReply(): Promise<{ on: boolean; text: string }> {
  const svc = createServiceClient();
  const { data } = await svc.from("site_settings").select("key, value").in("key", [TEXT_KEY, ON_KEY]);
  const map = new Map((data ?? []).map((r) => [String(r.key), String(r.value ?? "")]));
  return {
    on: (map.get(ON_KEY) ?? "1") === "1", // on unless switched off
    text: (map.get(TEXT_KEY) ?? "").trim() || DEFAULT_AUTO_REPLY,
  };
}

export async function saveAutoReply(text: string, on: boolean): Promise<void> {
  const svc = createServiceClient();
  await svc.from("site_settings").upsert(
    [
      { key: TEXT_KEY, value: text.slice(0, 4000) },
      { key: ON_KEY, value: on ? "1" : "0" },
    ],
    { onConflict: "key" },
  );
}

/** Fire the acknowledgement for one inbound message, if it is due. */
export async function autoReplyTo(phone: string): Promise<boolean> {
  const to = (phone ?? "").replace(/\D/g, "");
  if (!to) return false;
  const { on, text } = await getAutoReply();
  if (!on || !text) return false;

  const svc = createServiceClient();
  // Did we already greet this number recently?
  const since = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();
  const { data: recent } = await svc
    .from("notifications")
    .select("id")
    .eq("channel", "whatsapp")
    .eq("template", "autoreply")
    .gte("sent_at", since)
    .contains("payload", { to })
    .limit(1);
  if (recent && recent.length) return false;

  const ok = await sendWhatsAppText(to, text);
  await svc.from("notifications").insert({
    student_id: null,
    channel: "whatsapp",
    template: "autoreply",
    payload: { to },
    status: ok ? "sent" : "failed",
    sent_at: new Date().toISOString(),
  });
  return ok;
}
