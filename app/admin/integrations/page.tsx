import { createServiceClient } from "@/lib/supabase/service";
import { aiConfigured } from "@/lib/ai";
import { emailConfigured, whatsappConfigured, telegramConfigured, telegramBotUsername } from "@/lib/notify";
import { razorpayConfigured } from "@/lib/razorpay";
import { r2Configured } from "@/lib/r2";
import { getSecret } from "@/lib/secrets";
import AdminHero from "../_components/AdminHero";
import { connectTelegramWebhook, saveLinks, saveSecrets, testRazorpayConnection } from "./actions";
import SubmitButton from "@/app/components/SubmitButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations — Admin" };

async function telegramHealth() {
  const token = await getSecret("TELEGRAM_BOT_TOKEN");
  if (!token) return null;
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

// Masked input for a single key: shows whether it's already set, lets you paste a new one.
async function KeyField({ name, label, placeholder }: { name: string; label: string; placeholder: string }) {
  const set = Boolean(await getSecret(name));
  return (
    <div style={{ marginBottom: 12 }}>
      <label>
        {set ? "🟢 " : "⚪ "}{label} {set && <span className="muted" style={{ fontSize: ".78rem" }}>(set — leave blank to keep)</span>}
      </label>
      <input name={name} type="password" autoComplete="off" placeholder={set ? "•••••••• (saved)" : placeholder} />
    </div>
  );
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: { tg?: string; links?: string; keys?: string; rzp?: string; rzpmsg?: string };
}) {
  const [tg, ai, em, wa, rzp, r2, botUser, health, jooble] = await Promise.all([
    telegramConfigured(),
    aiConfigured(),
    emailConfigured(),
    whatsappConfigured(),
    razorpayConfigured(),
    r2Configured(),
    telegramBotUsername(),
    telegramHealth(),
    getSecret("JOOBLE_API_KEY"),
  ]);
  const jb = Boolean(jooble);
  const serp = Boolean(await getSecret("SERPAPI_KEY"));
  const bunny = Boolean(await getSecret("BUNNY_STREAM_API_KEY"));

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
        subtitle="Paste your API keys here — no Vercel needed. A green light means it's working."
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.tg === "set" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Telegram webhook connected.</div>}
      {searchParams.tg === "fail" && <div className="notice err" style={{ marginTop: 16 }}>⚠️ Couldn&apos;t connect the webhook — check the bot token.</div>}
      {searchParams.tg === "notoken" && <div className="notice err" style={{ marginTop: 16 }}>Add your Telegram bot token below first.</div>}
      {searchParams.links === "saved" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Links saved.</div>}
      {searchParams.keys === "saved" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Keys saved.</div>}

      {/* STATUS */}
      <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
        <Row on={tg} label="✈️ Telegram bot" help={
          tg ? (
            <>
              {health?.tokenValid
                ? <>Token valid — bot is <strong>@{health.botUsername}</strong>. </>
                : <>Token saved but Telegram rejected it — re-check it below. </>}
              {webhookOk
                ? <>Webhook connected ✅{health?.lastError ? ` (last error: ${health.lastError})` : ""}.</>
                : <>Webhook not connected — click the button below.</>}
              {health?.botUsername && botUser !== health.botUsername &&
                <><br/>⚠️ Set the bot username field below to <strong>{health.botUsername}</strong> so the “Connect Telegram” button works.</>}
            </>
          ) : <>Create a bot with <strong>@BotFather</strong> in Telegram, then paste its token + username below.</>
        } />
        {tg && (
          <form action={connectTelegramWebhook}>
            <button className="btn small" type="submit">🔗 Connect / refresh Telegram webhook</button>
          </form>
        )}
        <Row on={ai} label="🤖 AI (doubts, tests, grading)" help={<>Key from <a className="grad" href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a> → API Keys (needs billing).</>} />
        <Row on={em} label="✉️ Email (Mailgun)" help={<>Key + domain from your <a className="grad" href="https://app.mailgun.com" target="_blank" rel="noreferrer">Mailgun</a> account.</>} />
        <Row on={wa} label="💬 WhatsApp (Interakt)" help={<>Key from <a className="grad" href="https://app.interakt.ai" target="_blank" rel="noreferrer">Interakt</a> → Settings → Developer Settings. Bulk WhatsApp also needs an approved template.</>} />
        <Row on={rzp} label="💳 Razorpay (payments)" help={<>Key ID + Secret from <a className="grad" href="https://dashboard.razorpay.com" target="_blank" rel="noreferrer">Razorpay</a> → Settings → API Keys. After saving, click <strong>Test</strong> below before going live.</>} />
        {rzp && (
          <form action={testRazorpayConnection}>
            <button className="btn small" type="submit">🧪 Test Razorpay keys</button>
          </form>
        )}
        {searchParams.rzpmsg && (
          <div className={`notice ${searchParams.rzp === "ok" ? "ok" : "err"}`}>{searchParams.rzpmsg}</div>
        )}
        <Row on={bunny} label="🎬 Bunny Stream (class video uploads)" help={<>Stream API key from <a className="grad" href="https://dash.bunny.net" target="_blank" rel="noreferrer">dash.bunny.net</a> → Stream → your library → API. Paste it below so the &ldquo;Upload video&rdquo; button works (videos go straight to Bunny). Also set the Library ID if it differs from the default.</>} />
        <Row on={r2} label="🗄️ Cloudflare R2 (PDF/image storage)" help={<>Optional cheaper storage for PDFs/images (free bandwidth). Keys from <a className="grad" href="https://dash.cloudflare.com" target="_blank" rel="noreferrer">Cloudflare</a> → R2 → Manage API Tokens. When set, new uploads go to R2; existing files keep working. <strong>Remember to allow your site in the bucket&apos;s CORS settings (PUT).</strong></>} />
        <Row on={serp} label="🎓 Google Jobs (placement — SerpAPI)" help={<>Paid key from <a className="grad" href="https://serpapi.com" target="_blank" rel="noreferrer">serpapi.com</a> — powers the placement feed with real Indian CA / articleship openings from Google for Jobs (correct locations). When set, this is used instead of Jooble. Paste below, then “Fetch latest openings now” in <strong>Admin → Student placement</strong>.</>} />
        <Row on={jb} label="🎓 Jooble (placement — free fallback)" help={<>Free key from <a className="grad" href="https://jooble.org/api/about" target="_blank" rel="noreferrer">jooble.org/api/about</a>. Used only if no Google Jobs key is set. Note: it mislabels locations, so results can be noisier.</>} />
      </div>

      {/* PASTE KEYS */}
      <div className="form-card" style={{ marginTop: 24 }}>
        <h3>🔑 Paste your keys</h3>
        <p className="muted" style={{ fontSize: ".85rem", marginBottom: 12 }}>
          Stored securely on the server (never shown to students). Blank fields are left unchanged.
          Type <code>CLEAR</code> to remove a key.
        </p>
        <form action={saveSecrets}>
          <KeyField name="TELEGRAM_BOT_TOKEN" label="Telegram bot token" placeholder="123456:ABC-DEF…" />
          <KeyField name="TELEGRAM_BOT_USERNAME" label="Telegram bot username (no @)" placeholder="my121bot" />
          <KeyField name="TELEGRAM_CHANNEL_ID" label="Telegram channel (for broadcasts)" placeholder="@caparveen" />
          <KeyField name="ANTHROPIC_API_KEY" label="Anthropic (AI) key" placeholder="sk-ant-…" />
          <KeyField name="BUNNY_STREAM_API_KEY" label="Bunny Stream API key (video uploads)" placeholder="from dash.bunny.net → Stream → API" />
          <KeyField name="BUNNY_LIBRARY_ID" label="Bunny Library ID (optional)" placeholder="e.g. 682810" />
          <KeyField name="BUNNY_ACCOUNT_API_KEY" label="Bunny ACCOUNT API key (for live cost on Costs page)" placeholder="dash.bunny.net → Account → API" />
          <KeyField name="SERPAPI_KEY" label="Google Jobs (SerpAPI) key — placement" placeholder="from serpapi.com" />
          <KeyField name="JOOBLE_API_KEY" label="Jooble key (free fallback) — placement" placeholder="from jooble.org/api/about" />
          <KeyField name="MAILGUN_API_KEY" label="Mailgun API key" placeholder="key-…" />
          <KeyField name="MAILGUN_DOMAIN" label="Mailgun domain" placeholder="mg.121caclasses.com" />
          <KeyField name="MAILGUN_REGION" label="Mailgun region — type eu if your domain is EU (mxa.eu.mailgun.org)" placeholder="eu  (or leave blank for US)" />
          <KeyField name="INTERAKT_API_KEY" label="Interakt (WhatsApp) key" placeholder="Basic auth key" />
          <KeyField name="FACULTY_TELEGRAM_CHAT_ID" label="Faculty Telegram chat id (for doubt alerts)" placeholder="your own Telegram chat id" />
          <KeyField name="FACULTY_EMAIL" label="Faculty alert email" placeholder="help@121caclasses.com" />
          <KeyField name="CRON_SECRET" label="Cron secret (optional — protects scheduled jobs)" placeholder="any random text" />
          <KeyField name="RAZORPAY_KEY_ID" label="Razorpay Key ID" placeholder="rzp_live_… or rzp_test_…" />
          <KeyField name="RAZORPAY_KEY_SECRET" label="Razorpay Key Secret" placeholder="from Razorpay dashboard" />
          <div style={{ borderTop: "1px solid var(--border)", margin: "12px 0", paddingTop: 12 }}>
            <p className="muted" style={{ fontSize: ".82rem", marginBottom: 8 }}>Cloudflare R2 (optional cheaper storage for PDFs/images):</p>
          </div>
          <KeyField name="R2_ACCOUNT_ID" label="R2 Account ID" placeholder="Cloudflare account id" />
          <KeyField name="R2_ACCESS_KEY_ID" label="R2 Access Key ID" placeholder="from R2 API token" />
          <KeyField name="R2_SECRET_ACCESS_KEY" label="R2 Secret Access Key" placeholder="from R2 API token" />
          <KeyField name="R2_BUCKET" label="R2 Bucket name" placeholder="e.g. 121-files" />
          <KeyField name="R2_PUBLIC_BASE" label="R2 Public URL (custom domain or r2.dev)" placeholder="https://files.121caclasses.com" />
          <SubmitButton className="btn" style={{ marginTop: 6 }}>Save keys</SubmitButton>
        </form>
      </div>

      {/* PUBLIC LINKS */}
      <div className="form-card" style={{ marginTop: 18 }}>
        <h3>🔗 Public links (footer &amp; dashboard buttons)</h3>
        <form action={saveLinks}>
          <label>Telegram channel link</label>
          <input name="support_telegram" defaultValue={L.get("support_telegram") || ""} placeholder="https://t.me/caparveen" />
          <label>WhatsApp channel / chat link</label>
          <input name="support_whatsapp" defaultValue={L.get("support_whatsapp") || ""} placeholder="https://whatsapp.com/channel/…" />
          <label>Instagram link</label>
          <input name="support_instagram" defaultValue={L.get("support_instagram") || ""} placeholder="https://instagram.com/…" />
          <SubmitButton className="btn" style={{ marginTop: 14 }}>Save links</SubmitButton>
        </form>
      </div>
    </section>
  );
}
