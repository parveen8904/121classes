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
      entry?: { changes?: { value?: { messages?: Record<string, unknown>[] } }[] }[];
    };
    const inbound = (body.entry ?? [])
      .flatMap((e) => e.changes ?? [])
      .flatMap((c) => c.value?.messages ?? [])
      .filter((m) => m.from);
    if (inbound.length) {
      const { createServiceClient } = await import("@/lib/supabase/service");
      const svc = createServiceClient();
      for (const m of inbound) {
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
      }
    }
  } catch { /* always 200 — Meta retries hard on failures */ }
  return NextResponse.json({ ok: true });
}
