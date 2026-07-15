-- Campaign module: scheduled_posts grows into multi-channel campaigns.
-- Telegram/Discord/WhatsApp post automatically; Instagram/YouTube are
-- "prepare-and-remind" (the platforms don't allow reliable auto-posting, so we
-- email the drafted post to the admins to publish manually).

alter table public.scheduled_posts
  add column if not exists campaign text,
  add column if not exists to_whatsapp boolean not null default false,
  add column if not exists wa_template text,
  add column if not exists wa_offset int not null default 0,
  add column if not exists to_instagram boolean not null default false,
  add column if not exists to_youtube boolean not null default false;
