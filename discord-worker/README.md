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

## The 4 environment variables (needed on every host)
- `DISCORD_BOT_TOKEN` — same bot token as the website.
- `SUPABASE_URL` — `https://xmeltwyfvzhhurtcjfiu.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API → **service_role** key (keep secret).
- `TELEGRAM_BOT_TOKEN` — same Telegram bot token (so Discord messages relay to Telegram).

## Deploy — pick ONE host

### Option A — Railway (easiest, ~$5 hobby credit/mo)
1. railway.app → **New Project → Deploy from GitHub repo** → pick this repo.
2. In the service **Settings → Root Directory** set `discord-worker`.
3. **Variables** → add the 4 env vars above. Deploy. (Railway auto-detects Node and the Dockerfile.)

### Option B — Fly.io (has a small free allowance)
```bash
cd discord-worker
fly launch --no-deploy          # accept the existing fly.toml
fly secrets set DISCORD_BOT_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TELEGRAM_BOT_TOKEN=...
fly deploy
```

### Option C — Render (simplest UI, but background workers are paid ~$7/mo)
Render → **New → Blueprint** → pick this repo (uses `render.yaml`). Add the 4 env vars when prompted.

### Verify
Whatever you pick, the logs should print:
`Discord worker ready as <bot>; watching N channel(s).`
If N is 0, set the subjects' **Discord channel id** in Admin → Integrations first.

## Notes
- The service_role key bypasses RLS — only put it in the worker's server env, never in client code.
- The worker ignores messages from bots/webhooks (prevents echo loops with the
  website/Telegram relays).
- Moderation rules mirror `lib/moderation.ts`; keep them in sync if you tune them.
