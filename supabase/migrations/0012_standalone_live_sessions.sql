-- Standalone scheduled live classes (independent of any course/topic) — for
-- Zoom/Meet sessions scheduled for a batch/audience and pushed to students +
-- the public landing page.
drop table if exists live_sessions cascade;

create table live_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  audience text,                 -- free-text "for whom" (e.g. "CA Final FR batch", "All students")
  starts_at timestamptz,
  duration_mins integer default 60,
  join_url text,
  recording_url text,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

alter table live_sessions enable row level security;

-- Anyone may read PUBLISHED sessions (students + the public landing teaser).
-- Writes go through the service-role client in admin actions (no client policy).
create policy live_sessions_read on live_sessions
  for select using (is_published = true);
