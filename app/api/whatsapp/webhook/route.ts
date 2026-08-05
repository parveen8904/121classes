import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

// Meta WhatsApp Cloud API webhook. GET is Meta's one-time subscription
// handshake; POST receives message statuses and inbound student messages.
// Inbound texts are recorded so a reply stays inside the free 24h service
// window; everything else is acknowledged and dropped.
export async function GET(req: NextRequest) {
  const p = new URL(req.url).searchParams;
  const expected = (await getSecret("WHATSAPP_WEBHOOK_VERIFY_TOKEN")).trim();
  if (p.get("hub.mode") === "subscribe" && expected && p.get("hub.verify_token") === expected) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "verification failed" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      entry?: {
        changes?: {
          value?: {
            messages?: Record<string, unknown>[];
            metadata?: { phone_number_id?: string };
          };
        }[];
      }[];
    };
    // WHICH of our numbers received this. On the personal line — the one that
    // also lives on his phone under Coexistence — only students and leads are
    // recorded; family and everyone else pass through and are never stored.
    const inbound = (body.entry ?? [])
      .flatMap((e) => e.changes ?? [])
      .flatMap((c) =>
        (c.value?.messages ?? []).map((m) => ({ m, phoneNumberId: c.value?.metadata?.phone_number_id })),
      )
      .filter((x) => x.m.from);
    if (inbound.length) {
      const { createServiceClient } = await import("@/lib/supabase/service");
      const svc = createServiceClient();
      const { autoReplyTo } = await import("@/lib/whatsappAutoReply");
      const { shouldRecord, isPersonalLine } = await import("@/lib/whatsappPrivacy");
      const greeted = new Set<string>();
      for (const { m, phoneNumberId } of inbound) {
        const from = String(m.from ?? "");

        // Not ours to keep.
        if (!(await shouldRecord(phoneNumberId, from))) continue;
        // The whole message object is kept: WhatsApp puts button payloads,
        // interactive replies and template content in fields that vary by
        // type, and a text-only read silently loses all of them.
        await svc.from("notifications").insert({
          student_id: null,
          channel: "whatsapp",
          template: "inbound",
          payload: m,
          status: "received",
        });

        // Nobody should message us and hear nothing back. One acknowledgement
        // per sender — autoReplyTo also holds a 12h window of its own, so a
        // long conversation never gets a robot between every line.
        //
        // Never on the personal line: an automatic greeting from a number he
        // answers himself would read as though he had replied.
        if (await isPersonalLine(phoneNumberId)) continue;

        // A real question is ANSWERED, not acknowledged.
        //
        // The site tells students they can ask any time. On Telegram that was
        // true — message the bot, the AI answers from his material. On WhatsApp
        // every message got the same canned line and then waited for a human,
        // so the promise was only half kept on the channel students actually
        // use. The business number is live and verified, and a reply inside the
        // 24-hour window costs nothing.
        const text = String((m.text as { body?: string } | undefined)?.body ?? "").trim();
        let handled = false;
        if (text) {
          try {
            const { answerWhatsAppDoubt } = await import("@/lib/whatsappAnswer");
            const outcome = await answerWhatsAppDoubt(from, text);
            handled = outcome !== "ignored";
          } catch (e) {
            console.error("[whatsapp] could not answer", e instanceof Error ? e.message : e);
          }
        }

        // Only greet when there was nothing to answer — a robot greeting on top
        // of a real answer reads as though nobody had read the message.
        if (!handled && from && !greeted.has(from)) {
          greeted.add(from);
          await autoReplyTo(from).catch(() => false);
        }
      }
    }
  } catch { /* always 200 — Meta retries hard on failures */ }
  return NextResponse.json({ ok: true });
}
