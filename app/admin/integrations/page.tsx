import { createServiceClient } from "@/lib/supabase/service";
import { aiConfigured } from "@/lib/ai";
import { emailConfigured, whatsappConfigured, telegramConfigured, telegramBotUsername } from "@/lib/notify";
import AdminHero from "../_components/AdminHero";
import { connectTelegramWebhook, saveLinks } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations — Admin" };

async function telegramHealth() {
  if (!telegramConfigured()) return null;
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  try {
    const [meR, whR] = await Promise.all([
      fetch(`https://api.telegram.org/bot${token}/getMe`, { cache: "no-store" }),
      fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { cache: "no-store" }),
    ]);
    const me = await meR.json();
    const wh = await whR.json();
    return {
      tokenValid: !!me?.ok,
      botUsername: me?.result?.username as string | undefined,
      webhookUrl: wh?.result?.url as string | undefined,
      pending: wh?.result?.pending_update_count as number | undefined,
      lastError: wh?.result?.last_error_message as string | undefined,
    };
  } catch {
    return { tokenValid: false } as const;
  }
}

function Row({ on, label, help }: { on: boolean; label: string; help: React.ReactNode }) {
  return (
    <div className="card" style={{ borderColor: on ? "#22c55e" : "var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: "1.2rem" }}>{on ? "🟢" : "⚪"}</span>
        <strong>{label}</strong>
        <span className="badge" style={{ marginLeft: "auto", color: on ? "#22c55e" : "var(--muted)", borderColor: on ? "#22c55e" : "var(--border)" }}>
          {on ? "Connected" : "Not set"}
        </span>
      </div>
      <p className="muted" style={{ fontSize: ".84rem", marginTop: 8 }}>{help}</p>
    </div>
  );
}

export default async function IntegrationsPage({ searchParams }: { searchParams: { tg?: string; links?: string } }) {
  const tg = telegramConfigured();
  const health = await telegramHealth();
  const svc = createServiceClient();
  const { data: links } = await svc
    .from("site_settings")
    .select("key, value")
    .in("key", ["support_telegram", "support_whatsapp", "support_instagram"]);
  const L = new Map((links ?? []).map((r) => [r.key, r.value as string]));

  const webhookOk = !!health?.webhookUrl;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
      <AdminHero
        badge="🔌 Integrations"
        title="Connections & keys"
        subtitle="A green light means it's working. Add keys in Vercel → Settings → Environment Variables, then redeploy."
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.tg === "set" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Telegram webhook connected.</div>}
      {searchParams.tg === "fail" && <div className="notice err" style={{ marginTop: 16 }}>⚠️ Couldn&apos;t connect the webhook — check the bot token.</div>}
      {searchParams.tg === "notoken" && <div className="notice err" style={{ marginTop: 16 }}>Add TELEGRAM_BOT_TOKEN first.</div>}
      {searchParams.links === "saved" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Links saved.</div>}

      <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
        <Row on={tg} label="✈️ Telegram bot" help={
          tg ? (
            <>
              {health?.tokenValid
                ? <>Token valid — bot is <strong>@{health.botUsername}</strong>. </>
                : <>Token is set but Telegram rejected it — double-check TELEGRAM_BOT_TOKEN. </>}
              {webhookOk
                ? <>Webhook connected ✅{health?.lastError ? ` (last error: ${health.lastError})` : ""}.</>
                : <>Webhook not connected yet — click the button below.</>}
              {health?.botUsername && telegramBotUsername() !== health.botUsername &&
                <><br/>⚠️ Set <code>TELEGRAM_BOT_USERNAME={health.botUsername}</code> in Vercel so the “Connect Telegram” button works.</>}
            </>
          ) : <>Create a bot with <strong>@BotFather</strong> on Telegram, then add <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_BOT_USERNAME</code> in Vercel.</>
        } />

        {tg && (
          <form action={connectTelegramWebhook}>
            <button className="btn small" type="submit">🔗 Connect / refresh Telegram webhook</button>
          </form>
        )}

        <Row on={aiConfigured()} label="🤖 AI (doubts, tests, grading)" help={
          <>Add <code>ANTHROPIC_API_KEY</code> from <a className="grad" href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a> → API Keys (needs billing set up).</>
        } />
        <Row on={emailConfigured()} label="✉️ Email (Mailgun)" help={
          <>Add <code>MAILGUN_API_KEY</code> + <code>MAILGUN_DOMAIN</code> from your <a className="grad" href="https://app.mailgun.com" target="_blank" rel="noreferrer">Mailgun</a> account (Sending → Domain settings → API keys).</>
        } />
        <Row on={whatsappConfigured()} label="💬 WhatsApp (Interakt)" help={
          <>Add <code>INTERAKT_API_KEY</code> from your <a className="grad" href="https://app.interakt.ai" target="_blank" rel="noreferrer">Interakt</a> account → Settings → Developer Settings. Bulk WhatsApp also needs an approved message template.</>
        } />
      </div>

      <div className="form-card" style={{ marginTop: 24 }}>
        <h3>🔗 Public links (footer &amp; dashboard buttons)</h3>
        <p className="muted" style={{ fontSize: ".85rem", marginBottom: 10 }}>
          Paste your links here — they turn on the Join buttons across the site. No code needed.
        </p>
        <form action={saveLinks}>
          <label>Telegram channel link</label>
          <input name="support_telegram" defaultValue={L.get("support_telegram") || ""} placeholder="https://t.me/caparveen" />
          <label>WhatsApp channel / chat link</label>
          <input name="support_whatsapp" defaultValue={L.get("support_whatsapp") || ""} placeholder="https://whatsapp.com/channel/…" />
          <label>Instagram link</label>
          <input name="support_instagram" defaultValue={L.get("support_instagram") || ""} placeholder="https://instagram.com/…" />
          <button className="btn" type="submit" style={{ marginTop: 14 }}>Save links</button>
        </form>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <p className="muted" style={{ fontSize: ".83rem", margin: 0 }}>
          <strong>Tip:</strong> after adding any key in Vercel, you must <strong>redeploy</strong> (Vercel → Deployments → ⋯ → Redeploy)
          for it to take effect. Then refresh this page — the light turns green.
        </p>
      </div>
    </section>
  );
}
