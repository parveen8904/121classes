-- WHAT THE GROUPS HAVE ALREADY BEEN NUDGED ABOUT.
--
-- 26 Aug 2026, his instruction: when a study group goes quiet, keep telling
-- them to take a test, work their planner, look at the new articleship
-- openings, apply for the scholarship, or read a new article.
--
-- Recorded per group so the rotation does not repeat itself, and so a quiet
-- week cannot turn into the same sentence posted every few hours.
create table if not exists public.group_nudges (
  id       bigserial   primary key,
  chat_id  text        not null,
  kind     text        not null,
  sent_at  timestamptz not null default now()
);

create index if not exists group_nudges_chat_sent_idx
  on public.group_nudges (chat_id, sent_at desc);

alter table public.group_nudges enable row level security;
-- Written and read only by the nudge cron through the service client.
