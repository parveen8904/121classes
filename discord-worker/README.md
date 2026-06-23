# Discord discussion worker

Always-on bot that powers the **Discord → website/Telegram** side of the two-way
group discussion. (Discord doesn't push channel messages over HTTP, so this must
run as a persistent process — it can't live on Vercel.)

It reads messages in mapped channels, **moderates** them (deletes + logs the bad
ones), **stores** them in Supabase (`group_messages`, source `discord`), and
**relays** clean ones to the subject's Telegram group. The website chat shows them
live via Supabase Realtime; website/Telegram → Discord is handled by the main app.

## Discord setup (one-time)
1. Discord Developer Portal → your app → **Bot** → enable **MESSAGE CONTENT INTENT**
   (Privileged Gateway Intents). Save.
2. Invite the bot to your server with scopes `bot` + permissions **Read Messages**,
   **Send Messages**, **Manage Messages** (for deletion).
3. In the website: Admin → Integrations → **Subject groups** → set each subject's
   **Discord channel id** (right-click the channel → Copy Channel ID).

## Deploy (pick one always-on host — free tiers exist)
**Railway / Render / Fly.io** (recommended) or any small VPS.

Environment variables:
- `DISCORD_BOT_TOKEN` — same bot token as the website.
- `SUPABASE_URL` — `https://xmeltwyfvzhhurtcjfiu.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API → service_role key (keep secret).
- `TELEGRAM_BOT_TOKEN` — same Telegram bot token (so Discord messages relay to Telegram).

Then:
```bash
npm install
npm start
```
On Railway/Render: set the start command to `npm start`, add the 4 env vars, deploy.
The log should print: `Discord worker ready as <bot>; watching N channel(s).`

## Notes
- The service_role key bypasses RLS — only put it in the worker's server env, never in client code.
- The worker ignores messages from bots/webhooks (prevents echo loops with the
  website/Telegram relays).
- Moderation rules mirror `lib/moderation.ts`; keep them in sync if you tune them.
