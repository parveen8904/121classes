import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { telegramConfigured } from "@/lib/notify";

export const dynamic = "force-dynamic";

// Admin-only: point the Telegram bot at our webhook. Visit /api/telegram/setup
// once after setting TELEGRAM_BOT_TOKEN (and optional TELEGRAM_WEBHOOK_SECRET).
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });

  if (!telegramConfigured()) {
    return NextResponse.json({ ok: false, error: "Set TELEGRAM_BOT_TOKEN first." });
  }

  const origin = new URL(req.url).origin;
  const webhookUrl = `${origin}/api/telegram/webhook`;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const params: Record<string, string> = { url: webhookUrl };
  if (secret) params.secret_token = secret;

  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json({ ok: res.ok, webhookUrl, telegram: data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) });
  }
}
