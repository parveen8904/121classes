-- WHO HAS ALREADY BEEN ASKED TO CONNECT THEIR TELEGRAM.
--
-- The students-only backstop used to DELETE the message and BAN the sender the
-- moment somebody posted whose Telegram id was not linked to a portal account.
-- Only 9.5% of students (373 of 3,910) have ever linked theirs, so that rule
-- treated nine students in ten as an intruder: 36 people were removed from the
-- two study groups, at least two of them with a live paid subscription, and the
-- CA Intermediate group fell from 68 messages a day to silence on 21 Aug 2026.
--
-- It now asks them instead of removing them, and this records who has been
-- asked so the room is not told the same thing twice in a day.
create table if not exists public.group_link_reminders (
  chat_id     text        not null,
  tg_user_id  text        not null,
  reminded_at timestamptz not null default now(),
  times       integer     not null default 1,
  primary key (chat_id, tg_user_id)
);

alter table public.group_link_reminders enable row level security;
-- Written only by the Telegram webhook through the service client; no policy
-- is granted to anyone else, so RLS denies all direct access by design.
