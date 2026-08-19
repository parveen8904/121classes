// The single list of provider keys the admin can paste on the Integrations
// page. BOTH sides use it: the save action stores only these names, and
// KeyField refuses to render a field that is not on it — so a field can never
// again exist on the page while its value is silently thrown away on save
// (16 social keys sat in exactly that state).
export const SECRET_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_CHANNEL_ID",
  "FCM_SERVICE_ACCOUNT",
  "APNS_KEY_P8",
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "DISCORD_WEBHOOK_URL",
  "DISCORD_APP_ID",
  "DISCORD_PUBLIC_KEY",
  "DISCORD_BOT_TOKEN",
  "DISCORD_ASK_CHANNELS",
  "ANTHROPIC_API_KEY",
  "YOUTUBE_API_KEY",
  "YOUTUBE_CHANNEL_ID",
  // Uploading a Short is a WRITE on the channel, so the read-only API key
  // above cannot do it — Google requires OAuth for that.
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_REFRESH_TOKEN",
  "MAILGUN_API_KEY",
  "MAILGUN_WEBHOOK_KEY",
  "MAILGUN_DOMAIN",
  "MAILGUN_REGION",
  "NOTIFY_FROM_EMAIL",
  "NOTIFY_REPLY_TO",
  "AI_REPLY_BCC",
  "BACKUP_EMAIL",
  "DROPBOX_APP_KEY",
  "DROPBOX_APP_SECRET",
  "DROPBOX_REFRESH_TOKEN",
  "DROPBOX_ACCESS_TOKEN",
  "INTERAKT_API_KEY",
  "FACULTY_TELEGRAM_CHAT_ID",
  "FACULTY_EMAIL",
  "CRON_SECRET",
  // DELHIVERY — booking parcels without writing docket numbers by hand.
  // A key that is not named here is silently DISCARDED when the founder saves
  // it, which is the quietest way possible to make an integration look broken.
  "DELHIVERY_TOKEN",
  "DELHIVERY_CLIENT_NAME",
  // The registered warehouse name, character for character and CASE SENSITIVE
  // — Delhivery matches on it exactly and rejects the booking otherwise.
  "DELHIVERY_PICKUP_NAME",
  // "staging" until they confirm the account is live, then "live". The live
  // token is a DIFFERENT string from the staging one.
  "DELHIVERY_ENV",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE",
  "JOOBLE_API_KEY",
  "SERPAPI_KEY",
  "BUNNY_STREAM_API_KEY",
  "BUNNY_LIBRARY_ID",
  "BUNNY_ACCOUNT_API_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "ZOOM_SDK_KEY",
  "ZOOM_SDK_SECRET",
  "ZOOM_WEBHOOK_SECRET_TOKEN",
  "IVR_WEBHOOK_KEY",
  "WHATSAPP_OTP_TEMPLATE",
  "WHATSAPP_MISSEDCALL_TEMPLATE",
  // Social auto-posting + partner bridge. These fields existed on the page for
  // DAYS while missing from this list — everything pasted into them was
  // silently thrown away on save. If you add a KeyField to the page, it MUST
  // be added here, or it is a text box wired to nothing (page.tsx imports
  // SECRET_KEYS and refuses to render an unlisted field for exactly this
  // reason).
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_USER_ID",
  // The founder's MAIN account (@ca_parveen_sharma, 19.5K) — on the API since
  // 19 Aug 2026, when its page was partner-shared to the Aldine CA business and
  // assigned to the Portal Bot system user. Same token reaches both accounts.
  "INSTAGRAM_USER_ID_MAIN",
  "FACEBOOK_PAGE_ID",
  "FACEBOOK_PAGE_TOKEN",
  "LINKEDIN_ACCESS_TOKEN",
  "LINKEDIN_AUTHOR_URN",
  "TWITTER_API_KEY",
  "TWITTER_API_SECRET",
  "TWITTER_ACCESS_TOKEN",
  "TWITTER_ACCESS_SECRET",
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
  "REDDIT_USERNAME",
  "REDDIT_PASSWORD",
  "REDDIT_SUBREDDIT",
  "ALDINE_WEBHOOK_SECRET",
  // Zoho Books. These were read by lib/zoho.ts from the very first day but were
  // never on this list, so the page had no field for them — the integration sat
  // "waiting for keys" that had nowhere to be pasted.
  "ZOHO_CLIENT_ID",
  "ZOHO_CLIENT_SECRET",
  "ZOHO_REFRESH_TOKEN",
  "ZOHO_ORG_ID",
  // One-click live classes (OBS → Cloudflare Stream → portal).
  "CLOUDFLARE_STREAM_TOKEN",
  "LIVE_CONTROL_KEY",
  // X posting through the founder's Buffer account (free plan, personal key).
  "BUFFER_API_KEY",
  "BUFFER_X_CHANNEL_ID",
  // WhatsApp Cloud API (direct Meta, replaced Interakt). Token is the
  // never-expiring "Portal Bot" system-user token from the Aldine portfolio.
  "WHATSAPP_CLOUD_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_WABA_ID",
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_PERSONAL_PHONE_ID",
  "META_APP_ID",
  "META_EMBEDDED_SIGNUP_CONFIG_ID",
  // Threads (graph.threads.net — its own app id/secret and tokens; an IG or
  // FB token will not work). Token/user id/refresh stamp are written by the
  // OAuth callback, the app keys are pasted from the Meta dev portal.
  "THREADS_APP_ID",
  "THREADS_APP_SECRET",
  "THREADS_ACCESS_TOKEN",
  "THREADS_USER_ID",
  "THREADS_TOKEN_REFRESHED_AT",
  "THREADS_OAUTH_STATE",
] as const;

export type SecretKeyName = (typeof SECRET_KEYS)[number];
export function isSavableSecret(name: string): boolean {
  return (SECRET_KEYS as readonly string[]).includes(name);
}
