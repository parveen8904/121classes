-- A NIGHT THAT NEVER RAN MUST BE IMPOSSIBLE TO OVERLOOK.
--
-- The nightly sheet is strictly the orders placed on one IST day, which is
-- predictable — but it removed the old safety net: nothing sweeps a missed
-- night into the next sheet any more. So a miss has to be VISIBLE instead, and
-- visible needs a record of which nights actually went.
--
-- One row per IST day, written after the mail is away. `sent` is how many
-- addresses accepted it; a row with sent = 0 is a failure that happened, and a
-- day with NO row at all is a night that never ran (a dead cron, a deploy that
-- ate the schedule). /admin/warehouse reads the last fortnight and warns.
create table if not exists public.warehouse_dispatch_runs (
  day          date primary key,
  ran_at       timestamptz not null default now(),
  parcels      integer not null default 0,
  sent         integer not null default 0,
  recipients   integer not null default 0,
  error        text,
  by_hand      boolean not null default false
);

comment on table public.warehouse_dispatch_runs is
  'One row per IST day the warehouse sheet was sent. A missing day = a night that never ran; sent=0 = a night that failed. Read by /admin/warehouse to warn.';

alter table public.warehouse_dispatch_runs enable row level security;
-- Server-side only: the service key bypasses RLS, and no browser key should
-- ever read or write this. No policies is deliberate, not an omission.
