-- "Notify me" subscriptions for live classes/events, and the site-wide
-- "Ask me" question inbox. Both accept anonymous (logged-out) submissions.

create table if not exists class_reminders (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references live_sessions(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  email text,
  phone text,
  created_at timestamptz not null default now()
);
alter table class_reminders enable row level security;
-- anyone may subscribe; nobody but admins (service role) may read.
create policy reminders_insert on class_reminders
  for insert to anon, authenticated with check (true);

create index if not exists class_reminders_session on class_reminders (session_id);

create table if not exists page_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  email text,
  page_path text,
  question text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
alter table page_questions enable row level security;
create policy questions_insert on page_questions
  for insert to anon, authenticated with check (true);
-- a signed-in user may read their own questions (to show replies later).
create policy questions_read_own on page_questions
  for select to authenticated using (user_id = auth.uid());

create index if not exists page_questions_order on page_questions (created_at desc);
