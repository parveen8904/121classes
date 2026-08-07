-- Let the founder decide what gets encoded first.
--
-- The queue is worked least-recently-attempted first, which is fair but blind:
-- a class going out to students on Monday sits behind three hundred others. A
-- priority the admin can raise puts it at the front of the next pass without
-- disturbing anything else.
--
-- Higher runs first. 0 is the normal queue; anything above it jumps.
alter table offline_jobs
  add column if not exists priority integer not null default 0;

-- The drain reads (priority desc, updated_at asc) on every pass, every five
-- minutes, over ~900 rows. Cheap to index, and it keeps that query off a scan.
create index if not exists offline_jobs_queue_order
  on offline_jobs (priority desc, updated_at asc)
  where status in ('pending', 'running');

comment on column offline_jobs.priority is
  'Higher is worked first. Set from Admin → Reports → Offline encoding queue.';
