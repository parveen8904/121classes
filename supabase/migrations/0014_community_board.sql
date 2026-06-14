-- Global community board: every student posts and reads in one place; the
-- founder's posts can be pinned to the top and are visible to all.
create table if not exists community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now()
);

alter table community_posts enable row level security;

create policy community_read on community_posts
  for select to authenticated using (true);
create policy community_insert on community_posts
  for insert to authenticated with check (author_id = auth.uid());
create policy community_delete_own on community_posts
  for delete to authenticated using (author_id = auth.uid());

create index if not exists community_posts_order on community_posts (is_pinned desc, created_at desc);
