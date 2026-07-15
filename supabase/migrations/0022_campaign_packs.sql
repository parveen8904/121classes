-- Campaign packs: one scheduled post can carry platform-specific variants —
-- the Telegram/WhatsApp message (body), an Instagram caption with hashtags,
-- and a YouTube community-post text. created_by marks autopilot-scheduled posts.

alter table public.scheduled_posts
  add column if not exists ig_text text,
  add column if not exists yt_text text,
  add column if not exists created_by text;
