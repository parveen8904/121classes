-- Wave 2 auth: mandatory password (verify-once) + single-device enforcement.

-- 1) Track whether a user has set a password. Backfill TRUE for anyone who
--    already has one so existing password users are never re-prompted.
alter table profiles add column if not exists has_password boolean not null default false;
update profiles p set has_password = true
  from auth.users u
  where u.id = p.id and u.encrypted_password is not null and u.encrypted_password <> '';

-- 2) One active session per device kind (mobile / desktop). A newer login on the
--    same kind overwrites the token; the older device then fails the check and is
--    signed out. A phone and a computer are different kinds, so both can be active.
create table if not exists device_sessions (
  user_id uuid not null references profiles(id) on delete cascade,
  device_kind text not null,
  token text not null,
  user_agent text,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_kind)
);
alter table device_sessions enable row level security;
create policy device_sessions_select_own on device_sessions
  for select to authenticated using (user_id = auth.uid());
create policy device_sessions_insert_own on device_sessions
  for insert to authenticated with check (user_id = auth.uid());
create policy device_sessions_update_own on device_sessions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
