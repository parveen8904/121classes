-- Repository of encrypted, downloadable classes for the desktop app (Mac/Win).
-- The encrypted file lives on a CDN (public is fine — useless without the key).
-- The AES key is stored here server-side and released ONLY to a logged-in
-- student who passes has_subject_access — never via RLS/public select.

create table if not exists protected_videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subject_id uuid references subjects(id) on delete set null,
  section_id uuid references sections(id) on delete set null,
  min_plan plan_tier not null default 'gold',
  storage_url text not null,        -- public CDN URL of the AES-encrypted file
  key_b64 text not null,            -- AES key (base64) — SERVER ONLY, never exposed
  iv_b64 text,                      -- AES IV (base64), if the cipher needs it
  alg text not null default 'aes-256-cbc',
  byte_size bigint,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

alter table protected_videos enable row level security;
-- No policies = no client may read rows (incl. key). Access via the functions below.

create or replace function list_downloadable_classes()
returns table (
  id uuid, title text, subject_id uuid, subject_title text,
  storage_url text, iv_b64 text, alg text, byte_size bigint
)
language sql stable security definer set search_path = public as $$
  select pv.id, pv.title, pv.subject_id, s.title, pv.storage_url, pv.iv_b64, pv.alg, pv.byte_size
  from protected_videos pv
  left join subjects s on s.id = pv.subject_id
  where pv.is_published
    and (pv.subject_id is null or has_subject_access(pv.subject_id, pv.min_plan));
$$;

create or replace function get_protected_class_key(p_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare k text;
begin
  select pv.key_b64 into k
  from protected_videos pv
  where pv.id = p_id
    and pv.is_published
    and (pv.subject_id is null or has_subject_access(pv.subject_id, pv.min_plan));
  return k;
end;
$$;

revoke all on function list_downloadable_classes() from public;
revoke all on function get_protected_class_key(uuid) from public;
grant execute on function list_downloadable_classes() to authenticated;
grant execute on function get_protected_class_key(uuid) to authenticated;
