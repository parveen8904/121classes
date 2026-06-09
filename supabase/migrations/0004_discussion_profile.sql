-- =====================================================================
-- 121 Coaching — Discussion boards, new section types, profile fields
-- Run in Supabase: SQL Editor → paste → Run. Safe to re-run.
-- NOTE: enum ADD VALUE is intentionally NOT wrapped in an explicit
-- transaction (Postgres restricts using a new enum value in the same txn).
-- =====================================================================

-- ---------- New section types ----------
alter type section_type add value if not exists 'discussion';
alter type section_type add value if not exists 'discussion_video';

-- ---------- Profile fields (shipping address + GST) ----------
alter table profiles add column if not exists address_line1 text;
alter table profiles add column if not exists address_line2 text;
alter table profiles add column if not exists city          text;
alter table profiles add column if not exists state         text;
alter table profiles add column if not exists pincode       text;
alter table profiles add column if not exists gstin         text;
alter table profiles add column if not exists business_name text;

-- ---------- Discussion threads & posts ----------
create table if not exists discussion_threads (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references sections(id) on delete cascade,
  author_id   uuid not null references profiles(id) on delete cascade,
  title       text not null,
  body        text,
  is_resolved boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists discussion_posts (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references discussion_threads(id) on delete cascade,
  author_id   uuid not null references profiles(id) on delete cascade,
  body        text not null,
  pdf_url     text,
  video_ref   text,                       -- e.g. "Video 7 @ 12:30"
  is_solution boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_threads_section on discussion_threads(section_id);
create index if not exists idx_posts_thread on discussion_posts(thread_id);

alter table discussion_threads enable row level security;
alter table discussion_posts   enable row level security;

-- Any signed-in user can read; authors create their own; author or admin edits/deletes (moderation).
drop policy if exists dt_read   on discussion_threads;
drop policy if exists dt_insert on discussion_threads;
drop policy if exists dt_modify on discussion_threads;
drop policy if exists dt_delete on discussion_threads;
create policy dt_read   on discussion_threads for select using (auth.uid() is not null);
create policy dt_insert on discussion_threads for insert with check (author_id = auth.uid());
create policy dt_modify on discussion_threads for update using (author_id = auth.uid() or is_admin()) with check (author_id = auth.uid() or is_admin());
create policy dt_delete on discussion_threads for delete using (author_id = auth.uid() or is_admin());

drop policy if exists dp_read   on discussion_posts;
drop policy if exists dp_insert on discussion_posts;
drop policy if exists dp_modify on discussion_posts;
drop policy if exists dp_delete on discussion_posts;
create policy dp_read   on discussion_posts for select using (auth.uid() is not null);
create policy dp_insert on discussion_posts for insert with check (author_id = auth.uid());
create policy dp_modify on discussion_posts for update using (author_id = auth.uid() or is_admin()) with check (author_id = auth.uid() or is_admin());
create policy dp_delete on discussion_posts for delete using (author_id = auth.uid() or is_admin());
