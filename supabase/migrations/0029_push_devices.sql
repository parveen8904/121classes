-- WHERE A PUSH NOTIFICATION IS SENT.
--
-- One row per phone, not per student: a student with an iPhone and an iPad
-- gets the announcement on both, and a phone that is handed on to somebody
-- else re-registers under the new owner rather than quietly notifying the
-- wrong person.
--
-- The token is issued by Firebase and changes on its own — on reinstall, on
-- restore from backup, sometimes for no visible reason — so the app sends it
-- on every launch and this table takes the newest one.

create table if not exists push_devices (
  -- The FCM registration token IS the identity of the device. Making it the
  -- primary key is what stops the same phone accumulating a row per launch,
  -- and what makes a handed-on phone move to its new owner instead of
  -- doubling up.
  token         text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  platform      text not null check (platform in ('ios','android','web')),
  -- Which build it is, so a notification that only makes sense on a newer app
  -- can be held back rather than opening a screen that isn't there.
  app_version   text,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  -- Set when Firebase tells us the token is dead. Kept rather than deleted so
  -- "how many students actually have the app" stays answerable.
  disabled_at   timestamptz
);

create index if not exists push_devices_user_idx on push_devices (user_id) where disabled_at is null;
create index if not exists push_devices_live_idx on push_devices (last_seen_at desc) where disabled_at is null;

alter table push_devices enable row level security;

-- A student may register and see their OWN devices, and nothing else. Sending
-- goes through the service role, so no policy grants a read of anyone else's
-- token — a leaked token is a licence to notify that phone.
drop policy if exists push_devices_own on push_devices;
create policy push_devices_own on push_devices
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
