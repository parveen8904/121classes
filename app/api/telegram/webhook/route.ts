import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegramMessage, notifyFaculty } from "@/lib/notify";
import { answerDoubtFromMaterial, aiConfigured, NEED_FACULTY } from "@/lib/ai";
import { getRepositoryContext } from "@/lib/repository";
import { getSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

// Telegram calls this when a student messages the bot. Two jobs:
//  1) /start <code>  → link the student's account to their Telegram chat id
//  2) any other text → answer the doubt (AI, repository-grounded later); if AI
//     can't help, tell them it's gone to faculty and store it for review.
export async function POST(req: NextRequest) {
  // Optional shared-secret check (set TELEGRAM_WEBHOOK_SECRET + pass it to setWebhook).
  const secret = await getSecret("TELEGRAM_WEBHOOK_SECRET");
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const msg = update?.message ?? update?.edited_message;
  const chatId: string | undefined = msg?.chat?.id ? String(msg.chat.id) : undefined;
  const text: string = (msg?.text ?? "").trim();
  if (!chatId || !text) return NextResponse.json({ ok: true });

  const svc = createServiceClient();

  // 1) Account linking via deep link: /start <code>
  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    if (code) {
      const { data: prof } = await svc
        .from("profiles")
        .select("id, full_name")
        .eq("telegram_link_code", code)
        .maybeSingle();
      if (prof) {
        await svc.from("profiles").update({ telegram_chat_id: chatId }).eq("id", prof.id);
        await sendTelegramMessage(
          chatId,
          `✅ Connected! Hi ${prof.full_name || "there"} — you'll now get updates here, and you can ask me any doubt anytime.`,
        );
        return NextResponse.json({ ok: true });
      }
    }
    await sendTelegramMessage(
      chatId,
      "👋 Welcome to 121 CA Classes! To connect your account, open the “Connect Telegram” button on your dashboard. You can also just type any doubt and I'll help.",
    );
    return NextResponse.json({ ok: true });
  }

  // 2) Treat as a doubt.
  const who = await svc
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  let answer: string | null = null;
  if (await aiConfigured()) {
    const material = await getRepositoryContext(null, 12000, { query: text });
    const raw = await answerDoubtFromMaterial(text, material);
    if (raw && raw.trim() !== NEED_FACULTY) answer = raw;
  }
  if (answer) {
    await sendTelegramMessage(chatId, answer + "\n\n— Guided by CA Parveen Sharma's team.");
  } else {
    await sendTelegramMessage(
      chatId,
      "✅ Got your doubt! Our faculty will review it and reply here soon.",
    );
    await notifyFaculty(
      "A student doubt needs your reply (Telegram)",
      `Question:\n${text}\n\nReply from Admin → Inbox.`,
    );
  }

  // Log it so faculty can see (and the student can follow up in their inbox).
  try {
    const { data: ins } = await svc
      .from("page_questions")
      .insert({
        user_id: who.data?.id ?? null,
        page_path: "telegram",
        question: text,
        status: answer ? "answered" : "open",
      })
      .select("id")
      .single();
    if (answer && who.data?.id && ins?.id) {
      await svc.from("page_questions").insert({
        user_id: who.data.id,
        question: answer,
        page_path: `reply:${ins.id}`,
        status: "reply",
      });
    }
  } catch {
    /* best-effort */
  }

  return NextResponse.json({ ok: true });
}
