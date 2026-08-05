import { NextResponse, type NextRequest } from "next/server";
import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// caparveensharma.com/tg → the DOUBT BOT, never the personal account.
//
// This is the whole point of the link. Told to "message us on Telegram", a
// student searches "CA Parveen Sharma" and lands in HIS private chat — Telegram
// search cannot be fixed from here, and with ten thousand students that is a
// phone nobody can answer. A link opens the bot directly and no search happens.
export async function GET(req: NextRequest) {
  const svc = createServiceClient();
  const { data } = await svc.from("site_settings").select("value").eq("key", "support_telegram").maybeSingle();
  const configured = String(data?.value ?? "").trim();
  const bot = (await getSecret("TELEGRAM_BOT_USERNAME")).trim().replace(/^@/, "");

  const url = configured.startsWith("http")
    ? configured
    : bot
      ? `https://t.me/${bot}`
      : "";
  if (!url) return NextResponse.redirect(new URL("/support", req.url), 302);
  return NextResponse.redirect(url, 302);
}
