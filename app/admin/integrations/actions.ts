"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { telegramConfigured } from "@/lib/notify";
import { str } from "../_lib/util";

async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin";
}

// Point the Telegram bot at our webhook (one click).
export async function connectTelegramWebhook() {
  if (!(await requireAdmin())) return;
  if (!telegramConfigured()) redirect("/admin/integrations?tg=notoken");

  const host = headers().get("host");
  const proto = headers().get("x-forwarded-proto") || "https";
  const webhookUrl = `${proto}://${host}/api/telegram/webhook`;
  const params: Record<string, string> = { url: webhookUrl };
  if (process.env.TELEGRAM_WEBHOOK_SECRET) params.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET;

  let ok = false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      cache: "no-store",
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  redirect(`/admin/integrations?tg=${ok ? "set" : "fail"}`);
}

// Save the public channel / social links (no code/SQL needed).
export async function saveLinks(formData: FormData) {
  if (!(await requireAdmin())) return;
  const svc = createServiceClient();
  const rows = [
    { key: "support_telegram", value: str(formData.get("support_telegram")) },
    { key: "support_whatsapp", value: str(formData.get("support_whatsapp")) },
    { key: "support_instagram", value: str(formData.get("support_instagram")) },
  ];
  for (const r of rows) {
    await svc.from("site_settings").upsert({ key: r.key, value: r.value }, { onConflict: "key" });
  }
  redirect("/admin/integrations?links=saved");
}
