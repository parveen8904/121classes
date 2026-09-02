import { getSecret } from "@/lib/secrets";

// What is connected, what is not, and what each one is holding up.
//
// The Integrations page is a long wall of key fields. Asked "which of these are
// still pending", the only way to answer was to read every field and remember
// what each one was for — which is how the Zoho keys sat "pending" for weeks
// while having no field to be pasted into at all.
//
// So each integration declares the keys it actually needs, what it unlocks, and
// where the key comes from. The page reads its own configuration rather than
// being described by hand.

export type IntegrationState = "live" | "partial" | "missing";

export type Integration = {
  id: string;
  icon: string;
  name: string;
  /** All of these must be present for the integration to work. */
  needs: string[];
  /** What the site can do once it is connected. */
  unlocks: string;
  /** Where the key comes from — the actual next step, not a vague pointer. */
  howTo: string;
  /** Nice-to-have rather than something students feel the absence of. */
  optional?: boolean;
};

export const INTEGRATIONS: Integration[] = [
  // ── Things students feel immediately ──────────────────────────────────────
  { id: "ai", icon: "🤖", name: "AI (Anthropic)", needs: ["ANTHROPIC_API_KEY"],
    unlocks: "Every answer, every marked paper, every drafted question. Without it the site cannot teach.",
    howTo: "console.anthropic.com → API keys." },
  { id: "email", icon: "✉️", name: "Email — sending", needs: ["MAILGUN_API_KEY", "MAILGUN_DOMAIN"],
    unlocks: "Verification, password resets, invoices, answers, reports.",
    howTo: "Mailgun → Sending → Domain settings → Sending keys." },
  { id: "email-in", icon: "📥", name: "Email — receiving", needs: ["MAILGUN_WEBHOOK_KEY"],
    unlocks: "Student mail to sir@ and contact@ being read and answered automatically.",
    howTo: "Mailgun → Settings → API security → HTTP webhook signing key. NOT the sending key." },
  { id: "payments", icon: "💳", name: "Payments (Razorpay)", needs: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
    unlocks: "Students buying a plan or a book themselves, without you granting access by hand.",
    howTo: "Razorpay dashboard → Settings → API keys." },
  { id: "video", icon: "🎬", name: "Video (Bunny Stream)", needs: ["BUNNY_STREAM_API_KEY", "BUNNY_LIBRARY_ID"],
    unlocks: "Class videos playing in the portal and the apps.",
    howTo: "dash.bunny.net → Stream → API." },
  { id: "push_android", icon: "🤖", name: "App notifications — Android (Firebase)", needs: ["FCM_SERVICE_ACCOUNT"],
    unlocks: "Notifications on Android phones — the only channel that reaches a student without their opening anything.",
    howTo: "Firebase console → Project settings → Service accounts → Generate new private key. Paste the whole JSON file." },
  { id: "push_ios", icon: "", name: "App notifications — iPhone (Apple)", needs: ["APNS_KEY_P8", "APNS_KEY_ID", "APNS_TEAM_ID"],
    unlocks: "The same notifications on iPhones and iPads. Separate from Firebase — Apple will not accept anyone else's key.",
    howTo: "developer.apple.com → Keys → + → tick Apple Push Notifications. The .p8 file downloads ONCE; paste its contents. Key ID is beside it, Team ID is top-right." },
  { id: "telegram", icon: "✈️", name: "Telegram", needs: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME"],
    unlocks: "Doubts answered in direct chats and study groups; the channel broadcast.",
    howTo: "@BotFather on Telegram." },
  { id: "whatsapp", icon: "💬", name: "WhatsApp (Meta Cloud API)", needs: ["WHATSAPP_CLOUD_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_WABA_ID"],
    unlocks: "The public WhatsApp number answering students directly.",
    howTo: "Meta Business → WhatsApp → API setup (system-user token)." },
  { id: "storage", icon: "🗄️", name: "Backups — off-site (Dropbox)", needs: ["DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "DROPBOX_REFRESH_TOKEN"],
    unlocks: "A copy of every backup outside this server, so a bad day is not the end of the business.",
    howTo: "dropbox.com/developers/apps → your app → App key & secret." },

  // ── Office and money ──────────────────────────────────────────────────────
  { id: "zoho", icon: "📒", name: "Zoho Books", needs: ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"],
    unlocks: "Approved sales, staff advances and expenses posting to your books instead of being typed in twice.",
    howTo: "api-console.zoho.in → Self Client (free) → client id + secret, then generate a refresh token for ZohoBooks.fullaccess." },
  { id: "aldine", icon: "🌉", name: "Aldine bridge", needs: ["ALDINE_WEBHOOK_SECRET"],
    unlocks: "A purchase on aldine.edu.in opening access here automatically, with no re-keying.",
    howTo: "Pick any long random phrase; paste the SAME one into the WooCommerce webhook on aldine.edu.in." },
  { id: "ivr", icon: "☎️", name: "Phone / IVR (Tata Smartflo)", needs: ["IVR_WEBHOOK_KEY"],
    unlocks: "Calls logged against the student who rang, and missed calls becoming tickets.",
    howTo: "Your Smartflo account manager provides the webhook key." },

  // ── Classes ───────────────────────────────────────────────────────────────
  { id: "zoom", icon: "📡", name: "Live classes (Zoom SDK)", needs: ["ZOOM_SDK_KEY", "ZOOM_SDK_SECRET"],
    unlocks: "Live classes running inside the portal under your own branding instead of a bare Zoom link.",
    howTo: "Zoom Marketplace → Build App → Meeting SDK → SDK key & secret." },
  { id: "cfstream", icon: "🎥", name: "One-click live (Cloudflare Stream)", needs: ["CLOUDFLARE_STREAM_TOKEN"],
    unlocks: "Going live straight from OBS into the portal, with no meeting to schedule.", optional: true,
    howTo: "Cloudflare dashboard → Stream → API token." },

  // ── Reach ─────────────────────────────────────────────────────────────────
  { id: "youtube", icon: "▶️", name: "YouTube", needs: ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID"], optional: true,
    unlocks: "Channel figures beside the visits and signups your videos actually send.",
    howTo: "Google Cloud console → YouTube Data API v3 key." },
  { id: "yt-upload", icon: "🎬", name: "YouTube Shorts posting",
    needs: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"],
    unlocks: "A campaign video posting itself to the channel as a Short. Instagram and Facebook Reels already post; YouTube is the one that still needs a person.",
    howTo: "The API key above can only READ. Google Cloud → Credentials → OAuth client (Desktop), then sign in once as the channel owner for a refresh token with scope youtube.upload." },
  { id: "instagram", icon: "📸", name: "Instagram", needs: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_USER_ID"], optional: true,
    unlocks: "Approved posts going out to Instagram automatically.",
    howTo: "Meta Business → your IG professional account → access token." },
  { id: "facebook", icon: "📘", name: "Facebook page", needs: ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_TOKEN"], optional: true,
    unlocks: "Approved posts going out to the Facebook page.",
    howTo: "Meta Business → Page → access token." },
  { id: "linkedin", icon: "💼", name: "LinkedIn", needs: ["LINKEDIN_ACCESS_TOKEN", "LINKEDIN_AUTHOR_URN"], optional: true,
    unlocks: "Approved posts going out to LinkedIn.",
    howTo: "LinkedIn developer app → OAuth token with w_member_social." },
  { id: "threads", icon: "🧵", name: "Threads", needs: ["THREADS_APP_ID", "THREADS_APP_SECRET", "THREADS_ACCESS_TOKEN"], optional: true,
    unlocks: "Approved posts going out to Threads.",
    howTo: "Meta dev portal → a THREADS app (an Instagram or Facebook token will not work), then connect." },
  { id: "twitter", icon: "🐦", name: "X / Twitter (direct)", needs: ["TWITTER_API_KEY", "TWITTER_API_SECRET", "TWITTER_ACCESS_TOKEN", "TWITTER_ACCESS_SECRET"], optional: true,
    unlocks: "Posting to X directly. Not needed if Buffer is connected — that already covers X.",
    howTo: "developer.x.com → app → keys and tokens. Paid tier." },
  { id: "reddit", icon: "👽", name: "Reddit", needs: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USERNAME", "REDDIT_PASSWORD"], optional: true,
    unlocks: "Approved posts going to your subreddit.",
    howTo: "reddit.com/prefs/apps → create a script app." },
  { id: "placement", icon: "🎓", name: "Job feed (Jooble)", needs: ["JOOBLE_API_KEY"], optional: true,
    unlocks: "CA openings pulled in automatically for the Career page.",
    howTo: "jooble.org/api/about — free key." },
  { id: "gstlookup", icon: "🧾", name: "GST lookup", needs: ["GST_LOOKUP_URL", "GST_LOOKUP_KEY"], optional: true,
    unlocks: "A GST number typed at checkout fills in the registered trade name, address, city, state and PIN — exactly as the register spells them. Without it the number is still checksum-verified and its state read from it; only the auto-fill waits.",
    howTo: "The GSTN's own API is open only to a GST Suvidha Provider, so use a reseller (ClearTax, Masters India, Signzy and others). Paste their taxpayer endpoint and key." },

  // ── Housekeeping ──────────────────────────────────────────────────────────
  { id: "supabase", icon: "🛠️", name: "Supabase management", needs: ["SUPABASE_ACCESS_TOKEN"], optional: true,
    unlocks: "Changing login capacity and database size from this panel instead of the Supabase dashboard.",
    howTo: "supabase.com → Account → Access tokens." },
];

export type IntegrationReport = Integration & {
  state: IntegrationState;
  missing: string[];
};

export async function integrationReport(): Promise<IntegrationReport[]> {
  const out: IntegrationReport[] = [];
  for (const it of INTEGRATIONS) {
    const present: string[] = [];
    const missing: string[] = [];
    for (const k of it.needs) {
      if ((await getSecret(k)).trim()) present.push(k);
      else missing.push(k);
    }
    const state: IntegrationState =
      missing.length === 0 ? "live" : present.length > 0 ? "partial" : "missing";
    out.push({ ...it, state, missing });
  }
  return out;
}
