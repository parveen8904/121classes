import { createServiceClient } from "@/lib/supabase/service";
import { aiConfigured } from "@/lib/ai";
import { emailConfigured, whatsappConfigured, telegramConfigured, telegramBotUsername } from "@/lib/notify";
import { razorpayConfigured } from "@/lib/razorpay";
import { r2Configured } from "@/lib/r2";
import { getSecret } from "@/lib/secrets";
import { metaStatus, inPlainEnglish } from "@/lib/metaStatus";
import AdminHero from "../_components/AdminHero";
import { connectTelegramWebhook, saveLinks, saveSecrets, testRazorpayConnection, sendTestEmail, registerDiscordCommand, saveSubjectGroup, setupAuthSmtp, getSupabaseInfra, raiseAuthPool, upgradeCompute } from "./actions";
import { isSavableSecret } from "./secretKeys";
import { integrationReport, type IntegrationReport } from "@/lib/integrationStatus";
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

// One line of the "what is still pending" panel: what it unlocks, what is
// missing, and the actual next step to get it.
function PendingRow({ r }: { r: IntegrationReport }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <strong style={{ fontSize: ".92rem" }}>{r.icon} {r.name}</strong>
        <span
          className="badge"
          style={r.state === "partial" ? { background: "rgba(245,158,11,.15)", color: "#b45309" } : undefined}
        >
          {r.state === "partial" ? "half done" : "not connected"}
        </span>
      </div>
      <p style={{ margin: "5px 0 0", fontSize: ".86rem", lineHeight: 1.55 }}>{r.unlocks}</p>
      <p className="muted" style={{ margin: "5px 0 0", fontSize: ".8rem" }}>
        Still needed: <code>{r.missing.join(", ")}</code> — {r.howTo}
      </p>
    </div>
  );
}

// Masked input for a single key: shows whether it's already set, lets you paste a new one.
// WHAT A CORRECT VALUE LOOKS LIKE.
//
// A green light meant "something is stored", never "the right thing is stored".
// The whole .p8 private key was pasted into the Apple Key ID box and sat there
// looking healthy while every notification Apple received was signed with a
// nonsense key id and thrown away. Nothing said a word.
//
// These are the shapes that are unmistakable. Anything not listed is left
// alone — a guess that cries wolf is worse than no check.
const SHAPES: Record<string, { ok: (v: string) => boolean; expected: string }> = {
  APNS_KEY_ID:  { ok: (v) => /^[A-Z0-9]{10}$/.test(v.trim()), expected: "ten characters, like L7U28SG58S" },
  APNS_TEAM_ID: { ok: (v) => /^[A-Z0-9]{10}$/.test(v.trim()), expected: "ten characters, like 32W63QKXH8" },
  APNS_KEY_P8:  { ok: (v) => v.includes("PRIVATE KEY"), expected: "the .p8 file contents, beginning -----BEGIN PRIVATE KEY-----" },
  FCM_SERVICE_ACCOUNT: {
    ok: (v) => { try { const j = JSON.parse(v); return Boolean(j.project_id && j.client_email && j.private_key); } catch { return false; } },
    expected: "the whole service-account JSON, with project_id, client_email and private_key",
  },
};

async function KeyField({ name, label, placeholder, multiline }: { name: string; label: string; placeholder: string; multiline?: boolean }) {
  // A field whose name is missing from SECRET_KEYS would LOOK saveable while
  // the save action silently drops it — 16 social keys sat in exactly that
  // state and everything pasted was lost. Refuse to render the trap.
  if (!isSavableSecret(name)) {
    return (
      <div style={{ marginBottom: 12, border: "1px solid #dc2626", borderRadius: 8, padding: "8px 12px" }}>
        <strong style={{ color: "#dc2626" }}>⚠️ {label}</strong>
        <div className="muted" style={{ fontSize: ".8rem" }}>
          This field is not wired to the save list ({name} missing from secretKeys.ts) — pasting here would be lost.
          Tell the developer.
        </div>
      </div>
    );
  }
  const stored = await getSecret(name);
  const set = Boolean(stored);
  const shape = SHAPES[name];
  const wrong = set && shape && !shape.ok(stored);
  return (
    <div style={{ marginBottom: 12 }}>
      <label>
        {wrong ? "🔴 " : set ? "🟢 " : "⚪ "}{label}{" "}
        {set && !wrong && <span className="muted" style={{ fontSize: ".78rem" }}>(set — leave blank to keep)</span>}
      </label>
      {/* Said loudly, because a wrong value here fails in total silence: Apple
          and Firebase simply refuse every message and nobody is told. */}
      {wrong && (
        <div className="notice err" style={{ margin: "0 0 6px", fontSize: ".82rem" }}>
          ⚠️ What is saved here does not look right — it is {stored.trim().length} characters
          {stored.includes("PRIVATE KEY") ? " and appears to be a private key" : ""}. Expected {shape.expected}.
          Nothing will be delivered until this is corrected.
        </div>
      )}
      {/* type=text (not password) so browser password managers can't autofill/overwrite
          the key you paste. The field is empty on load, so nothing is exposed.

          Some of these are not one line. A .p8 push key and a Firebase service
          account are several lines each, and a single-line input mangles them
          on paste — silently, and differently each time. Two good pastes of a
          real Apple key landed as 196 characters and then 53, neither of them
          a key, both stored without complaint. Multi-line secrets get a box
          that can hold them. */}
      {multiline ? (
        <textarea
          name={name}
          rows={5}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-form-type="other"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: ".78rem", width: "100%" }}
          placeholder={set ? "•••••••• (saved — leave blank to keep)" : placeholder}
        />
      ) : (
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
      )}
    </div>
  );
}

export default async function IntegrationsPage(
  props: {
    searchParams: Promise<{ which?: string; tg?: string; links?: string; keys?: string; rzp?: string; rzpmsg?: string; mailtest?: string; discord?: string; smtp?: string; smtpmsg?: string; infra?: string; inframsg?: string }>;
  }
) {
  const searchParams = await props.searchParams;
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
  const ivrKey = (await getSecret("IVR_WEBHOOK_KEY")).trim();
  const ivr = Boolean(ivrKey);
  // Admin-only page: showing the ready-made webhook URL removes every chance
  // of a typo when pasting it into the IVR provider's portal.
  const ivrUrl = ivrKey ? `https://caparveensharma.com/api/calls/webhook?key=${encodeURIComponent(ivrKey)}` : "";

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

  const infra = await getSupabaseInfra();
  const report = await integrationReport();
  const pendingNeeded = report.filter((r) => r.state !== "live" && !r.optional);
  const pendingOptional = report.filter((r) => r.state !== "live" && r.optional);
  const liveCount = report.filter((r) => r.state === "live").length;

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
      <AdminHero
        badge="🔌 Integrations"
        title="Connections & keys"
        subtitle="Paste your API keys here — no Vercel needed. A green light means it's working."
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* "Are we verified yet?" used to mean logging into Business Manager and
          hunting. Meta will just tell us, using the token we already hold. */}
      <MetaPanel />

      {/* The answer to "which of these are still pending", without reading
          eighty key fields and remembering what each one was for. */}
      <div className="card" style={{ marginTop: 18 }}>
        <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
          🔎 What is connected — {liveCount} of {report.length}
        </h2>
        {pendingNeeded.length === 0 ? (
          <p className="muted" style={{ margin: "6px 0 0", fontSize: ".9rem" }}>
            ✅ Everything students depend on is connected. Anything left below is optional reach.
          </p>
        ) : (
          <p className="muted" style={{ margin: "6px 0 0", fontSize: ".9rem" }}>
            <strong>{pendingNeeded.length}</strong> still to do that students or the office actually feel, and{" "}
            {pendingOptional.length} optional.
          </p>
        )}

        {pendingNeeded.length > 0 && (
          <>
            <h3 style={{ fontSize: ".92rem", margin: "14px 0 6px" }}>Worth doing</h3>
            <div style={{ display: "grid", gap: 8 }}>
              {pendingNeeded.map((r) => <PendingRow key={r.id} r={r} />)}
            </div>
          </>
        )}
        {pendingOptional.length > 0 && (
          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: ".9rem" }}>
              Optional — nothing breaks without these ({pendingOptional.length})
            </summary>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {pendingOptional.map((r) => <PendingRow key={r.id} r={r} />)}
            </div>
          </details>
        )}
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: ".9rem" }}>
            ✅ Already connected ({liveCount})
          </summary>
          <p className="muted" style={{ fontSize: ".85rem", margin: "8px 0 0" }}>
            {report.filter((r) => r.state === "live").map((r) => `${r.icon} ${r.name}`).join(" · ")}
          </p>
        </details>
      </div>

      {searchParams.tg === "set" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Telegram connected — bot verified, username saved, webhook registered. Students can now tap &ldquo;Connect Telegram&rdquo; on their dashboard.</div>}
      {searchParams.tg === "fail" && <div className="notice err" style={{ marginTop: 16 }}>⚠️ Token is valid but the webhook didn&apos;t register — try again in a moment.</div>}
      {searchParams.tg === "notoken" && <div className="notice err" style={{ marginTop: 16 }}>Add your Telegram bot token below first.</div>}
      {searchParams.tg === "badtoken" && <div className="notice err" style={{ marginTop: 16 }}>⚠️ That bot token isn&apos;t valid. Get a real one from @BotFather (it looks like <code>123456789:AA…</code>, ~46 chars) and paste it in the Telegram bot token field below.</div>}
      {searchParams.links === "saved" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Links saved.</div>}
      {searchParams.discord === "registered" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Discord /ask command registered. It can take up to ~1 hour to appear in your server.</div>}
      {searchParams.discord === "failed" && <div className="notice err" style={{ marginTop: 16 }}>⚠️ Couldn&apos;t register — check the Discord App ID and Bot Token below, then try again.</div>}
      {searchParams.smtp === "ok" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Done — Supabase login emails now go through your Mailgun. The bounce warning is history.</div>}
      {searchParams.smtp === "notoken" && <div className="notice err" style={{ marginTop: 16 }}>Paste your Supabase access token below first (supabase.com/dashboard/account/tokens → Generate new token), then press the SMTP button again.</div>}
      {searchParams.smtp === "nomailgun" && <div className="notice err" style={{ marginTop: 16 }}>Mailgun key/domain missing — fill those fields first.</div>}
      {searchParams.smtp === "mgfail" && <div className="notice err" style={{ marginTop: 16 }}>⚠️ Mailgun didn&apos;t accept the SMTP credential — check the Mailgun API key and domain.</div>}
      {searchParams.smtp === "sbfail" && <div className="notice err" style={{ marginTop: 16 }}>⚠️ Mailgun is ready but Supabase rejected the settings{searchParams.smtpmsg ? <>: <code>{searchParams.smtpmsg}</code></> : ""} — check the access token.</div>}
      {searchParams.infra === "poolok" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Login capacity raised — the auth server can now use up to 30 database connections (was 10). Morning login rushes won&apos;t queue.</div>}
      {searchParams.infra === "computeok" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Database size change requested — it applies with a ~2-minute restart. Check back on this page in a few minutes.</div>}
      {searchParams.infra === "notoken" && <div className="notice err" style={{ marginTop: 16 }}>Paste your Supabase access token below first (same token as the SMTP button), Save keys, then retry.</div>}
      {searchParams.infra === "fail" && <div className="notice err" style={{ marginTop: 16 }}>⚠️ Supabase rejected the change{searchParams.inframsg ? <>: <code>{searchParams.inframsg}</code></> : ""}.</div>}
      {searchParams.discord === "missing" && <div className="notice err" style={{ marginTop: 16 }}>Add your Discord App ID and Bot Token below first, save keys, then register.</div>}
      {searchParams.keys === "saved" && <div className="notice ok" style={{ marginTop: 16 }}>✅ Keys saved.</div>}
        {/* A key that arrived damaged is NOT saved, and says so. Stored quietly,
            it would show a green light beside something that never works. */}
        {searchParams.keys === "bad" && (
          <div className="notice err" style={{ marginTop: 16 }}>
            ⚠️ Not saved: <strong>{(searchParams.which ?? "").split(",").join(", ")}</strong> — what arrived was not a usable
            key. It is usually a paste that lost part of itself. Copy the file whole (in Terminal:
            <code style={{ margin: "0 4px" }}>pbcopy &lt; yourkey.p8</code>) and paste it again. Everything else on this page was saved.
          </div>
        )}
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
        <Row on={ivr} label="📞 IVR / phone calls → tickets" help={<>Turns every call on your IVR number (98100 12674) into ticket activity — missed calls open a high-priority ticket automatically. Set the <strong>IVR webhook key</strong> below, then paste the ready-made URL into your IVR portal (Smartflo: Services → Webhook → Add Webhook, method POST). Works with MyOperator, Exotel, Knowlarity, Servetel/Tata Smartflo &amp; Ozonetel.</>} />
        {ivrUrl && (
          <div style={{ margin: "6px 0 10px" }}>
            <label style={{ fontSize: ".8rem" }}>📋 Copy this EXACT URL into the IVR webhook (don&apos;t retype it):</label>
            <input readOnly value={ivrUrl} style={{ fontFamily: "monospace", fontSize: ".78rem" }} />
          </div>
        )}
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
          <KeyField multiline name="FCM_SERVICE_ACCOUNT" label="Firebase service account (whole JSON file)" placeholder='{"type":"service_account","project_id":"…"}' />
          <KeyField multiline name="APNS_KEY_P8" label="Apple push key (.p8 file contents)" placeholder="-----BEGIN PRIVATE KEY-----…" />
          <KeyField name="APNS_KEY_ID" label="Apple push key ID" placeholder="ABC1234DEF" />
          <KeyField name="APNS_TEAM_ID" label="Apple team ID" placeholder="XYZ9876GHI" />
          <KeyField name="TELEGRAM_BOT_TOKEN" label="Telegram bot token" placeholder="123456:ABC-DEF…" />
          <KeyField name="TELEGRAM_BOT_USERNAME" label="Telegram bot username (no @)" placeholder="my121bot" />
          <KeyField name="TELEGRAM_CHANNEL_ID" label="Telegram channel (for broadcasts)" placeholder="@caparveen" />
          <KeyField name="YOUTUBE_API_KEY" label="YouTube Data API key (for revision-video durations + the YouTube panel)" placeholder="Google Cloud Console → APIs → YouTube Data API v3 → Create API key" />
          <KeyField name="YOUTUBE_CHANNEL_ID" label="YouTube channel (for Admin → YouTube performance)" placeholder="your channel link, @handle, or UC… id" />
          <KeyField name="DISCORD_WEBHOOK_URL" label="Discord channel webhook (for broadcasts)" placeholder="Discord → Server → channel → Edit → Integrations → Webhooks → New → Copy URL" />
          <KeyField name="DISCORD_APP_ID" label="Discord Application ID (for the /ask bot)" placeholder="Discord Developer Portal → your app → Application ID" />
          <KeyField name="DISCORD_PUBLIC_KEY" label="Discord Public Key (for the /ask bot)" placeholder="Developer Portal → your app → Public Key" />
          <KeyField name="DISCORD_BOT_TOKEN" label="Discord Bot Token (for the /ask bot)" placeholder="Developer Portal → your app → Bot → Reset Token → Copy" />
          <KeyField name="DISCORD_ASK_CHANNELS" label="Limit /ask to these channel IDs (comma-separated; blank = any channel)" placeholder="e.g. 123456789012345678, 234567…  (right-click a channel → Copy Channel ID)" />
          <KeyField name="INSTAGRAM_ACCESS_TOKEN" label="Instagram access token (auto-posts campaigns — needs your professional IG account linked to a Facebook Page)" placeholder="developers.facebook.com → your app → long-lived token with instagram_basic + instagram_content_publish" />
          <KeyField name="INSTAGRAM_USER_ID" label="Instagram user ID (numeric IG business-account id)" placeholder="Graph API → me/accounts → page → instagram_business_account id" />
          <p className="muted" style={{ fontSize: ".82rem", margin: "2px 0 10px" }}>
            🤝 Not sure of your Pages or the user ID? Paste just the token, save, then open{" "}
            <a href="/admin/integrations/meta" style={{ color: "var(--accent)", fontWeight: 700 }}>Instagram / Facebook check</a>{" "}
            — it lists your Pages in plain words and connects the right Instagram with one tap.
          </p>
          <KeyField name="FACEBOOK_PAGE_ID" label="Facebook Page ID (auto-posts campaigns to the Page)" placeholder="numeric Page id — the Instagram/Facebook check page shows it" />
          <KeyField name="FACEBOOK_PAGE_TOKEN" label="Facebook Page access token (permission: pages_manage_posts)" placeholder="developers.facebook.com → your app → Page token" />
          <KeyField name="LINKEDIN_ACCESS_TOKEN" label="LinkedIn access token (auto-posts campaigns)" placeholder="linkedin.com/developers → your app → OAuth token with w_member_social" />
          <KeyField name="LINKEDIN_AUTHOR_URN" label="LinkedIn author URN (who the post is from)" placeholder="urn:li:person:XXXX or urn:li:organization:12345678" />
          <KeyField name="TWITTER_API_KEY" label="X (Twitter) API key" placeholder="developer.x.com → your app → Keys and tokens" />
          <KeyField name="TWITTER_API_SECRET" label="X API key secret" placeholder="from the same Keys and tokens page" />
          <KeyField name="TWITTER_ACCESS_TOKEN" label="X access token (of your account)" placeholder="generate under Authentication Tokens with Read and Write" />
          <KeyField name="TWITTER_ACCESS_SECRET" label="X access token secret" placeholder="generated together with the access token" />
          <KeyField name="REDDIT_CLIENT_ID" label="Reddit app client id (auto-posts to your subreddit/profile)" placeholder="reddit.com/prefs/apps → create a 'script' app" />
          <KeyField name="REDDIT_CLIENT_SECRET" label="Reddit app secret" placeholder="shown on the same apps page" />
          <KeyField name="REDDIT_USERNAME" label="Reddit username" placeholder="the account that will post" />
          <KeyField name="REDDIT_PASSWORD" label="Reddit password" placeholder="that account's password (stored in the secret store)" />
          <KeyField name="REDDIT_SUBREDDIT" label="Reddit community to post in" placeholder="e.g. u_yourusername (your profile feed) or your own subreddit" />
          <KeyField name="ANTHROPIC_API_KEY" label="Anthropic (AI) key" placeholder="sk-ant-…" />
          <KeyField name="BUNNY_STREAM_API_KEY" label="Bunny Stream API key (video uploads)" placeholder="from dash.bunny.net → Stream → API" />
          <KeyField name="BUNNY_LIBRARY_ID" label="Bunny Library ID (optional)" placeholder="e.g. 682810" />
          <KeyField name="BUNNY_ACCOUNT_API_KEY" label="Bunny ACCOUNT API key (for live cost on Costs page)" placeholder="dash.bunny.net → Account → API" />
<KeyField name="ZOOM_SDK_KEY" label="Zoom Meeting SDK Key (white-label live classes)" placeholder="Zoom Marketplace → Build App → Meeting SDK → SDK Key" />
          <KeyField name="ZOOM_SDK_SECRET" label="Zoom Meeting SDK Secret" placeholder="from the same Meeting SDK app" />
          <KeyField name="ZOOM_WEBHOOK_SECRET_TOKEN" label="Zoom webhook secret token (auto-import class recordings to Bunny)" placeholder="Zoom app → Feature → Event Subscriptions → Secret Token" />
          <KeyField name="SERPAPI_KEY" label="Google Jobs (SerpAPI) key — placement" placeholder="from serpapi.com" />
          <KeyField name="JOOBLE_API_KEY" label="Jooble key (free fallback) — placement" placeholder="from jooble.org/api/about" />
          <KeyField name="ZOHO_CLIENT_ID" label="Zoho Books — client ID (approved sales & expenses post to your books)" placeholder="api-console.zoho.in → Self Client (free)" />
          <KeyField name="ZOHO_CLIENT_SECRET" label="Zoho Books — client secret" placeholder="same Self Client screen" />
          <KeyField name="ZOHO_REFRESH_TOKEN" label="Zoho Books — refresh token" placeholder="generated for scope ZohoBooks.fullaccess.all" />
          <KeyField name="ZOHO_ORG_ID" label="Zoho Books — organisation ID (optional, defaults to ALDINECA)" placeholder="leave blank unless you have two organisations" />
          <KeyField name="YOUTUBE_CLIENT_ID" label="YouTube upload — client ID (needed to post Shorts; the API key above can only read)" placeholder="Google Cloud → Credentials → OAuth client (Desktop)" />
          <KeyField name="YOUTUBE_CLIENT_SECRET" label="YouTube upload — client secret" placeholder="same OAuth client" />
          <KeyField name="YOUTUBE_REFRESH_TOKEN" label="YouTube upload — refresh token (sign in once as the channel owner)" placeholder="scope youtube.upload" />
          <KeyField name="MAILGUN_API_KEY" label="Mailgun API key" placeholder="key-…" />
          <KeyField name="MAILGUN_WEBHOOK_KEY" label="Mailgun HTTP webhook signing key — signs incoming student mail (NOT the sending key)" placeholder="Mailgun → Settings → API security → HTTP webhook signing key" />
          <KeyField name="MAILGUN_DOMAIN" label="Mailgun domain" placeholder="mg.caparveensharma.com" />
          <KeyField name="MAILGUN_REGION" label="Mailgun region — type eu if your domain is EU (mxa.eu.mailgun.org)" placeholder="eu  (or leave blank for US)" />
          <KeyField name="NOTIFY_FROM_EMAIL" label="From address (must be on the verified Mailgun domain)" placeholder="CA Parveen Sharma <noreply@caparveensharma.com>" />
          <KeyField name="NOTIFY_REPLY_TO" label="Reply-To address (where replies go, any domain)" placeholder="contact@caparveensharma.com" />
          <KeyField
            name="AI_REPLY_BCC"
            label="Blind-copy every AI reply here — you see each answer sent in your name, the student does not see you"
            placeholder="ps.smay@gmail.com  (leave blank to stop the copies)"
          />
          <KeyField
            name="BACKUP_EMAIL"
            label="Backup email — the weekly database backup is zipped and sent here"
            placeholder="use an address NOT on this domain, e.g. your Gmail"
          />
          <KeyField name="DROPBOX_APP_KEY" label="Dropbox app key — a copy of every backup goes to your Dropbox" placeholder="dropbox.com/developers/apps → your app → App key" />
          <KeyField name="DROPBOX_APP_SECRET" label="Dropbox app secret" placeholder="same page as the app key" />
          <KeyField name="DROPBOX_REFRESH_TOKEN" label="Dropbox refresh token (does not expire — use this one)" placeholder="from the one-time OAuth step; ask your developer" />
          <KeyField name="DROPBOX_ACCESS_TOKEN" label="Dropbox access token (quick start only — Dropbox expires these in hours)" placeholder="your app → Generate access token" />
          <KeyField name="INTERAKT_API_KEY" label="Interakt (WhatsApp) key" placeholder="Basic auth key" />
          <KeyField name="IVR_WEBHOOK_KEY" label="IVR webhook key (phone calls → tickets)" placeholder="any long random text — use the same in your IVR portal's webhook URL" />
          <KeyField name="META_APP_ID" label="Meta App ID (needed to connect your own WhatsApp number)" placeholder="developers.facebook.com → your app → App ID" />
          <KeyField name="META_EMBEDDED_SIGNUP_CONFIG_ID" label="Meta Embedded Signup configuration ID" placeholder="your app → WhatsApp → Configuration → create one, copy its ID" />
          <KeyField name="WHATSAPP_PERSONAL_PHONE_ID" label="Your personal number's phone ID (Coexistence — only students and leads are stored on it)" placeholder="filled in for you after you connect the number" />
          <KeyField name="WHATSAPP_OTP_TEMPLATE" label="WhatsApp OTP template name (verifies case-test leads)" placeholder="Interakt → Templates → an approved AUTHENTICATION template with one {{1}} variable" />
          <KeyField name="WHATSAPP_MISSEDCALL_TEMPLATE" label="WhatsApp missed-call reply template (sends the free-planner link to callers)" placeholder="approved MARKETING/UTILITY template with one {{1}} variable (the link)" />
          <KeyField name="FACULTY_TELEGRAM_CHAT_ID" label="Faculty Telegram chat id (for doubt alerts)" placeholder="your own Telegram chat id" />
          <KeyField name="FACULTY_EMAIL" label="Faculty alert email" placeholder="contact@caparveensharma.com" />
          <KeyField name="CRON_SECRET" label="Cron secret (optional — protects scheduled jobs)" placeholder="any random text" />
          <KeyField name="ALDINE_WEBHOOK_SECRET" label="Aldine bridge secret (same text goes in the WooCommerce webhook's Secret field)" placeholder="any long random text — e.g. 40 letters and digits" />
          <KeyField name="BUFFER_API_KEY" label="Buffer API key (auto-posts campaign X/Twitter drafts through your Buffer account)" placeholder="publish.buffer.com → Settings → API → create access token (org owner only)" />
          <KeyField name="BUFFER_X_CHANNEL_ID" label="Buffer X channel id (optional — auto-detected when blank)" placeholder="leave blank to use the first X/Twitter channel on the account" />
          <KeyField name="CLOUDFLARE_STREAM_TOKEN" label="Cloudflare Stream token (one-click live classes — OBS streams through Cloudflare)" placeholder="dash.cloudflare.com → My Profile → API Tokens → Create Token → Stream:Edit permission" />
          <KeyField name="LIVE_CONTROL_KEY" label="Live-class control key (already set — the Desktop Start/End Class buttons use it; type CLEAR + re-run setup to rotate)" placeholder="set automatically" />
          <KeyField name="SUPABASE_ACCESS_TOKEN" label="Supabase access token (for the one-click SMTP button below)" placeholder="supabase.com/dashboard/account/tokens → Generate new token → paste sbp_…" />
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
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 12 }}>
          <p className="muted" style={{ fontSize: ".85rem", marginBottom: 8 }}>
            📧 <strong>One-click:</strong> route Supabase&apos;s own login emails through your Mailgun (fixes the
            &ldquo;bounced emails&rdquo; warning). Needs the Mailgun key/domain and the Supabase access token saved above —
            everything else (SMTP credential, password, settings) is done automatically and never displayed.
          </p>
          <form action={setupAuthSmtp} style={{ margin: 0 }}>
            <SubmitButton className="btn small">🔐 Set up login-email SMTP via Mailgun</SubmitButton>
          </form>
        </div>
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 12 }}>
          <p className="muted" style={{ fontSize: ".85rem", marginBottom: 8 }}>
            🖥️ <strong>Server capacity (one-click, same token):</strong>{" "}
            {infra
              ? <>current database size: <strong>{infra.compute}</strong> · auth login-connections: <strong>{infra.authPool ?? "unknown"}</strong></>
              : <>paste the Supabase access token above to see and change these.</>}
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <form action={raiseAuthPool} style={{ margin: 0 }}>
              <SubmitButton className="btn small">🚪 Raise login capacity (10 → 30 connections)</SubmitButton>
            </form>
            <form action={upgradeCompute} style={{ margin: 0, display: "flex", gap: 8, alignItems: "center" }}>
              <select name="variant" defaultValue="ci_small" style={{ minWidth: 210 }}>
                <option value="ci_micro">Micro (~$10/mo)</option>
                <option value="ci_small">Small (~$15/mo) — recommended</option>
                <option value="ci_medium">Medium (~$60/mo)</option>
              </select>
              <SubmitButton className="btn small secondary">📈 Change database size</SubmitButton>
            </form>
          </div>
          <p className="muted" style={{ fontSize: ".76rem", marginTop: 6 }}>
            ⚠️ Changing the database size is a <strong>billing change</strong> (charged to your Supabase card,
            pro-rated) and restarts the database for ~2 minutes — best done late at night.
          </p>
        </div>
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

/**
 * What Meta currently thinks of us.
 *
 * Business verification, the WhatsApp account's review, and the number's own
 * state each live on a different object in Meta's world, which is why looking
 * in one place and concluding "nothing is happening" is so easy to do.
 */
async function MetaPanel() {
  const m = await metaStatus();
  if (!m.ok && !m.problem) return null;

  const Row = ({ label, value, note }: { label: string; value: string; note?: string }) => (
    <div style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
      <span style={{ minWidth: 210, fontSize: ".86rem" }}>{label}</span>
      <strong style={{ fontSize: ".86rem" }}>{value}</strong>
      {note && <span className="muted" style={{ fontSize: ".78rem" }}>{note}</span>}
    </div>
  );

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <h2 style={{ margin: 0, fontSize: "1.05rem" }}>📘 Facebook / Meta — where verification stands</h2>
      <p className="muted" style={{ margin: "6px 0 10px", fontSize: ".85rem" }}>
        Asked of Meta directly, using the WhatsApp token. Refreshed hourly.
      </p>

      {m.problem && (
        <div className="notice err" style={{ marginBottom: 10, fontSize: ".85rem" }}>
          Could not ask Meta: {m.problem}
        </div>
      )}

      {m.business && (
        <Row
          label="Business verification"
          value={
            m.business.verification_status
              ? inPlainEnglish("verification_status", m.business.verification_status)
              : "🔒 Meta will not say"
          }
          note={m.business.why ? `${m.business.name} — ${m.business.why}` : m.business.name}
        />
      )}
      {m.waba && (
        <Row
          label="WhatsApp account review"
          value={inPlainEnglish("account_review_status", m.waba.account_review_status)}
          note={m.waba.name}
        />
      )}
      {m.phone && (
        <>
          <Row label="Number" value={m.phone.display_phone_number || "—"} note={m.phone.verified_name} />
          <Row label="Display name" value={inPlainEnglish("name_status", m.phone.name_status)} />
          <Row label="Number verified" value={inPlainEnglish("code_verification_status", m.phone.code_verification_status)} />
          <Row label="Quality rating" value={inPlainEnglish("quality_rating", m.phone.quality_rating)} />
          <Row label="Can message" value={inPlainEnglish("messaging_limit", m.phone.messaging_limit)} />
        </>
      )}

      <p className="muted" style={{ margin: "10px 0 0", fontSize: ".8rem" }}>
        Business verification is what the soft WhatsApp verify prompt on the dashboard is waiting for.
        Until it says verified, that prompt stays hidden.
      </p>
    </div>
  );
}
