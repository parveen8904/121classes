import { createServiceClient } from "@/lib/supabase/service";
import { aiConfigured } from "@/lib/ai";
import { emailConfigured, whatsappConfigured, telegramConfigured, telegramBotUsername } from "@/lib/notify";
import { razorpayConfigured } from "@/lib/razorpay";
import { r2Configured } from "@/lib/r2";
import { getSecret } from "@/lib/secrets";
import AdminHero from "../_components/AdminHero";
import { connectTelegramWebhook, saveLinks, saveSecrets, testRazorpayConnection, sendTestEmail, registerDiscordCommand, saveSubjectGroup } from "./actions";
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
      {/* type=text (not password) so browser password managers can't autofill/overwrite
          the key you paste. The field is empty on load, so nothing is exposed. */}
      <input
        name={name}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        data-form-type="other"
        placeholder={set ? "•••••••• (saved — leave blank to keep)" : placeholder}
      />
    </div>
  );
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: { tg?: string; links?: string; keys?: string; rzp?: string; rzpmsg?: string; mailtest?: string; discord?: string };
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
    .in("key", ["support_telegram", "support_telegram_group", "support_discord", "whatsapp_channel", "support_whatsapp", "support_instagram", "support_youtube", "support_twitter", "support_facebook"]);
  const L = new Map((links ?? []).map((r) => [r.key, r.value as string]));
  const webhookOk = !!health?.webhookUrl;
  const { data: subjectRows } = await svc
    .from("subjects")
    .select("id, title, telegram_group_url, telegram_group_chat_id, discord_channel_id, order_index")
    .order("order_index")
    .order("title");
  const subjects = subjectRows ?? [];

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
      <AdminHero
        badge="🔌 Integrations"
        title="Connections & keys"
        subtitle="Paste your API keys here — no Vercel needed. A green light means it's working."
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.tg === "set" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Telegram connected — bot verified, username saved, webhook registered. Students can now tap &ldquo;Connect Telegram&rdquo; on their dashboard.</div>}
      {searchParams.tg === "fail" && <div className="notice err" style={{ marginTop: 16 }}>⚠️ Token is valid but the webhook didn&apos;t register — try again in a moment.</div>}
      {searchParams.tg === "notoken" && <div className="notice err" style={{ marginTop: 16 }}>Add your Telegram bot token below first.</div>}
      {searchParams.tg === "badtoken" && <div className="notice err" style={{ marginTop: 16 }}>⚠️ That bot token isn&apos;t valid. Get a real one from @BotFather (it looks like <code>123456789:AA…</code>, ~46 chars) and paste it in the Telegram bot token field below.</div>}
      {searchParams.links === "saved" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Links saved.</div>}
      {searchParams.discord === "registered" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Discord /ask command registered. It can take up to ~1 hour to appear in your server.</div>}
      {searchParams.discord === "failed" && <div className="notice err" style={{ marginTop: 16 }}>⚠️ Couldn&apos;t register — check the Discord App ID and Bot Token below, then try again.</div>}
      {searchParams.discord === "missing" && <div className="notice err" style={{ marginTop: 16 }}>Add your Discord App ID and Bot Token below first, save keys, then register.</div>}
      {searchParams.keys === "saved" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Keys saved.</div>}
      {searchParams.mailtest && <div className={`notice ${searchParams.mailtest.startsWith("✅") ? "ok" : "err"}`} style={{ marginTop: 16 }}>{searchParams.mailtest}</div>}

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
        <Row on={em} label="✉️ Email (Mailgun)" help={<>Key + domain from <a className="grad" href="https://app.mailgun.com" target="_blank" rel="noreferrer">Mailgun</a>. The <strong>domain below must exactly match a VERIFIED Mailgun domain</strong>, and set region <code>eu</code> if it&apos;s an EU domain. Then test ↓</>} />
        <form action={sendTestEmail}>
          <button className="btn small" type="submit">✉️ Send test email (shows the exact error)</button>
        </form>
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
        <form action={saveSecrets} autoComplete="off">
          <KeyField name="TELEGRAM_BOT_TOKEN" label="Telegram bot token" placeholder="123456:ABC-DEF…" />
          <KeyField name="TELEGRAM_BOT_USERNAME" label="Telegram bot username (no @)" placeholder="my121bot" />
          <KeyField name="TELEGRAM_CHANNEL_ID" label="Telegram channel (for broadcasts)" placeholder="@caparveen" />
          <KeyField name="YOUTUBE_API_KEY" label="YouTube Data API key (for revision-video durations)" placeholder="Google Cloud Console → APIs → YouTube Data API v3 → Create API key" />
          <KeyField name="DISCORD_WEBHOOK_URL" label="Discord channel webhook (for broadcasts)" placeholder="Discord → Server → channel → Edit → Integrations → Webhooks → New → Copy URL" />
          <KeyField name="DISCORD_APP_ID" label="Discord Application ID (for the /ask bot)" placeholder="Discord Developer Portal → your app → Application ID" />
          <KeyField name="DISCORD_PUBLIC_KEY" label="Discord Public Key (for the /ask bot)" placeholder="Developer Portal → your app → Public Key" />
          <KeyField name="DISCORD_BOT_TOKEN" label="Discord Bot Token (for the /ask bot)" placeholder="Developer Portal → your app → Bot → Reset Token → Copy" />
          <KeyField name="DISCORD_ASK_CHANNELS" label="Limit /ask to these channel IDs (comma-separated; blank = any channel)" placeholder="e.g. 123456789012345678, 234567…  (right-click a channel → Copy Channel ID)" />
          <KeyField name="ANTHROPIC_API_KEY" label="Anthropic (AI) key" placeholder="sk-ant-…" />
          <KeyField name="BUNNY_STREAM_API_KEY" label="Bunny Stream API key (video uploads)" placeholder="from dash.bunny.net → Stream → API" />
          <KeyField name="BUNNY_LIBRARY_ID" label="Bunny Library ID (optional)" placeholder="e.g. 682810" />
          <KeyField name="BUNNY_ACCOUNT_API_KEY" label="Bunny ACCOUNT API key (for live cost on Costs page)" placeholder="dash.bunny.net → Account → API" />
          <KeyField name="ZOOM_WEBHOOK_SECRET_TOKEN" label="Zoom webhook secret token (auto-import class recordings to Bunny)" placeholder="Zoom app → Feature → Event Subscriptions → Secret Token" />
          <KeyField name="SERPAPI_KEY" label="Google Jobs (SerpAPI) key — placement" placeholder="from serpapi.com" />
          <KeyField name="JOOBLE_API_KEY" label="Jooble key (free fallback) — placement" placeholder="from jooble.org/api/about" />
          <KeyField name="MAILGUN_API_KEY" label="Mailgun API key" placeholder="key-…" />
          <KeyField name="MAILGUN_DOMAIN" label="Mailgun domain" placeholder="mg.caparveensharma.com" />
          <KeyField name="MAILGUN_REGION" label="Mailgun region — type eu if your domain is EU (mxa.eu.mailgun.org)" placeholder="eu  (or leave blank for US)" />
          <KeyField name="NOTIFY_FROM_EMAIL" label="From address (must be on the verified Mailgun domain)" placeholder="CA Parveen Sharma <noreply@caparveensharma.com>" />
          <KeyField name="NOTIFY_REPLY_TO" label="Reply-To address (where replies go, any domain)" placeholder="contact@caparveensharma.com" />
          <KeyField name="INTERAKT_API_KEY" label="Interakt (WhatsApp) key" placeholder="Basic auth key" />
          <KeyField name="FACULTY_TELEGRAM_CHAT_ID" label="Faculty Telegram chat id (for doubt alerts)" placeholder="your own Telegram chat id" />
          <KeyField name="FACULTY_EMAIL" label="Faculty alert email" placeholder="contact@caparveensharma.com" />
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
          <KeyField name="R2_PUBLIC_BASE" label="R2 Public URL (custom domain or r2.dev)" placeholder="https://files.caparveensharma.com" />
          <SubmitButton className="btn" style={{ marginTop: 6 }}>Save keys</SubmitButton>
        </form>
        <p className="muted" style={{ fontSize: ".82rem", marginTop: 12 }}>
          🎥 <strong>Zoom auto-record:</strong> in your Zoom <em>Server-to-Server OAuth</em> app → <em>Feature → Event Subscriptions</em>, add the event
          <strong> &ldquo;Recording Completed&rdquo;</strong> with the webhook URL
          <code> https://caparveensharma.com/api/zoom/recording</code>, then paste that app&apos;s <strong>Secret Token</strong> above.
          After a live class, Zoom&apos;s cloud recording is then auto-imported into Bunny and attached to that class (matched by the Zoom join link).
        </p>
      </div>

      {/* PUBLIC LINKS */}
      <div className="form-card" style={{ marginTop: 18 }}>
        <h3>🔗 Public links (footer &amp; dashboard buttons)</h3>
        <form action={saveLinks}>
          <label>Telegram channel link (public — students follow &amp; it embeds on the site)</label>
          <input name="support_telegram" defaultValue={L.get("support_telegram") || ""} placeholder="https://t.me/yourchannel" />
          <label>Telegram group link (invite — students join &amp; chat)</label>
          <input name="support_telegram_group" defaultValue={L.get("support_telegram_group") || ""} placeholder="https://t.me/+AbCd… or https://t.me/yourgroup" />
          <label>Discord server invite (students join)</label>
          <input name="support_discord" defaultValue={L.get("support_discord") || ""} placeholder="https://discord.gg/…" />
          <label>WhatsApp channel link (students follow)</label>
          <input name="whatsapp_channel" defaultValue={L.get("whatsapp_channel") || ""} placeholder="https://whatsapp.com/channel/…" />
          <label>WhatsApp help / support number (optional)</label>
          <input name="support_whatsapp" defaultValue={L.get("support_whatsapp") || ""} placeholder="https://wa.me/91… or 9198…" />
          <h4 style={{ margin: "16px 0 4px" }}>Social media (footer)</h4>
          <label>YouTube link</label>
          <input name="support_youtube" defaultValue={L.get("support_youtube") || ""} placeholder="https://youtube.com/@…" />
          <label>Instagram link</label>
          <input name="support_instagram" defaultValue={L.get("support_instagram") || ""} placeholder="https://instagram.com/…" />
          <label>X (Twitter) link</label>
          <input name="support_twitter" defaultValue={L.get("support_twitter") || ""} placeholder="https://x.com/…" />
          <label>Facebook link</label>
          <input name="support_facebook" defaultValue={L.get("support_facebook") || ""} placeholder="https://facebook.com/…" />
          <SubmitButton className="btn" style={{ marginTop: 14 }}>Save links</SubmitButton>
        </form>
      </div>

      {/* Per-subject group setup — Telegram + Discord. */}
      <div className="form-card" style={{ marginTop: 18 }}>
        <h3>👥 Subject groups (Telegram &amp; Discord)</h3>
        <p className="muted" style={{ fontSize: ".84rem", marginTop: 0 }}>
          For each subject set its <strong>Telegram group</strong> (join link + chat id) and/or <strong>Discord channel id</strong>. The join link shows on the student dashboard; the chat/channel ids let the bot post &amp; sync the discussion. (Right-click a Discord channel → Copy Channel ID; Telegram chat ids look like <code>-100…</code>.)
        </p>
        <div style={{ display: "grid", gap: 12 }}>
          {subjects.map((s) => {
            const r = s as { id: string; title: string; telegram_group_url?: string | null; telegram_group_chat_id?: string | null; discord_channel_id?: string | null };
            return (
              <form key={r.id} action={saveSubjectGroup} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                <input type="hidden" name="subject_id" value={r.id} />
                <strong>{r.title}</strong>
                <label style={{ marginTop: 6 }}>Telegram group invite link (shown to students)</label>
                <input name="group_url" defaultValue={r.telegram_group_url ?? ""} placeholder="https://t.me/+AbCd…" />
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", marginTop: 8 }}>
                  <div>
                    <label>Telegram chat id (for posting)</label>
                    <input name="telegram_group_chat_id" defaultValue={r.telegram_group_chat_id ?? ""} placeholder="-1001234567890" />
                  </div>
                  <div>
                    <label>Discord channel id <span className="muted" style={{ fontWeight: 400 }}>(numeric — NOT the invite link)</span></label>
                    <input name="discord_channel_id" defaultValue={r.discord_channel_id ?? ""} placeholder="123456789012345678" />
                  </div>
                </div>
                <SubmitButton className="btn small" style={{ marginTop: 10 }}>Save {r.title}</SubmitButton>
              </form>
            );
          })}
        </div>
      </div>

      <div className="form-card" style={{ marginTop: 18 }}>
        <h3>🎮 Discord doubt bot (/ask)</h3>
        <p className="muted" style={{ fontSize: ".84rem", marginTop: 0 }}>
          Lets students type <code>/ask</code> in your Discord server and get an AI answer from your class material. The answer is <strong>private to the asker</strong> (ephemeral), and you can limit <code>/ask</code> to specific channels (key above). One-time setup:
        </p>
        <ol style={{ margin: "0 0 10px 18px", padding: 0, fontSize: ".84rem", color: "var(--muted)", display: "grid", gap: 4 }}>
          <li>In the <strong>Discord Developer Portal</strong>, create an Application → add a <strong>Bot</strong>.</li>
          <li>Copy the <strong>Application ID</strong>, <strong>Public Key</strong> and <strong>Bot Token</strong> into the keys above, then <strong>Save keys</strong>.</li>
          <li>In the app&apos;s <strong>General Information</strong>, set <strong>Interactions Endpoint URL</strong> to <code>https://caparveensharma.com/api/discord/interactions</code> and save (Discord will verify it).</li>
          <li>Invite the bot to your server (OAuth2 → URL Generator → scopes: <code>bot</code>, <code>applications.commands</code>).</li>
          <li>Then tap the button below to register the <code>/ask</code> command.</li>
        </ol>
        <form action={registerDiscordCommand}>
          <SubmitButton className="btn">Register the /ask command</SubmitButton>
        </form>
      </div>
    </section>
  );
}
