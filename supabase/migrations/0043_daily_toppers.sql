-- THE DAY'S TOPPERS, DECIDED AT 11:59 PM AND ANNOUNCED AT 3 AM.
--
-- Two jobs three hours apart, so the snapshot is FROZEN between them: whoever
-- is named at 11:59 is who is announced at 3, even if a copy is released in
-- between.
--
-- WHAT COUNTS AS "TODAY" IS THE RELEASE, NOT THE ATTEMPT. His rule: "if a paper
-- comes at 2 AM and it is released at 4 AM it will be counted in the next day."
-- The window sits on examiner_checked_at.
--
-- PRIVACY IS IN THE SHAPE OF THE TABLE. Only the student's id and the name to
-- read out; no phone, no email, and no marks — the announcement carries none,
-- and what is not stored cannot leak into a group chat.
create table if not exists public.daily_toppers (
  day           date        not null,
  track         text        not null check (track in ('inter','final')),
  student_id    uuid        references public.profiles(id) on delete set null,
  student_name  text        not null,
  decided_at    timestamptz not null default now(),
  announced_at  timestamptz,
  primary key (day, track)
);

comment on table public.daily_toppers is
  'One topper per track per IST day, chosen at 23:59 from copies RELEASED that day and announced at 03:00. No marks or contact details are stored — the announcement carries none.';

alter table public.daily_toppers enable row level security;
-- Server-side only. No browser key has any reason to read who topped before it
-- is announced.
