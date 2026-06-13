-- =====================================================================
-- 121 Coaching — image uploads (media bucket) + site image settings
-- Applied via Supabase MCP. Public bucket; only admins can upload.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "media_read" on storage.objects;
drop policy if exists "media_admin_insert" on storage.objects;
drop policy if exists "media_admin_update" on storage.objects;
drop policy if exists "media_admin_delete" on storage.objects;
create policy "media_read" on storage.objects for select using (bucket_id = 'media');
create policy "media_admin_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_admin());
create policy "media_admin_update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_admin());
create policy "media_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_admin());

create table if not exists site_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);
alter table site_settings enable row level security;
drop policy if exists ss_read on site_settings;
drop policy if exists ss_admin on site_settings;
create policy ss_read on site_settings for select using (true);
create policy ss_admin on site_settings for all using (is_admin()) with check (is_admin());
