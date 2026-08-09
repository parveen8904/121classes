-- COUNT EACH VISITOR ONCE, WHEN THEY FIRST ARRIVE.
--
-- "Visitors till today" was a full scan of page_views with a sort that spilled
-- to disk — 52ms across 36,000 rows, which was fine until launch day put 11,000
-- page views through in a single day. That query runs on every load of the
-- health page, and the table it scans now grows by tens of thousands a day.
--
-- So each distinct visitor is written down once, the first time they are seen,
-- and the all-time figure becomes a count of a small table instead of a
-- distinct-sort over a large one: 0.5ms instead of 52ms, and it grows with the
-- number of PEOPLE rather than the number of page views.
--
-- Maintained by a trigger rather than a nightly job, so it cannot drift from
-- reality by somebody forgetting to run something. Verified equal to the old
-- scan at the moment of backfill: 4,808 both ways.

create table if not exists visitor_seen (
  visitor_id text primary key,
  first_seen timestamptz not null default now()
);

alter table visitor_seen enable row level security;
-- No policy: reachable only through SECURITY DEFINER functions, like page_views.

insert into visitor_seen (visitor_id, first_seen)
select coalesce(user_id::text, visitor_key), min(created_at)
from page_views
where event = 'view' and coalesce(user_id::text, visitor_key) is not null
group by 1
on conflict (visitor_id) do nothing;

create or replace function public.note_visitor()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
begin
  if new.event = 'view' then
    insert into visitor_seen (visitor_id, first_seen)
    values (coalesce(new.user_id::text, new.visitor_key), new.created_at)
    on conflict (visitor_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists page_view_notes_visitor on page_views;
create trigger page_view_notes_visitor
  after insert on page_views
  for each row execute function public.note_visitor();

-- admin_visitor_report() now reads visitors_total and tracking_since from
-- visitor_seen. The full definition lives in 0034; only those two lines change.
