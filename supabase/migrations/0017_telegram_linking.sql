-- Wave 3: link a student's Telegram account so the bot can DM them and answer
-- their doubts. We never auto-add anyone (Telegram forbids it) — the student
-- taps a personal deep link once and the bot records their chat id.
alter table profiles add column if not exists telegram_chat_id text;
alter table profiles add column if not exists telegram_link_code text;
create unique index if not exists profiles_tg_link_code on profiles (telegram_link_code) where telegram_link_code is not null;
create index if not exists profiles_tg_chat on profiles (telegram_chat_id) where telegram_chat_id is not null;
