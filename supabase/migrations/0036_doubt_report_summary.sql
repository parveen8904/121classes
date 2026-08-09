-- THE DOUBT REPORT'S NUMBERS, COUNTED WHERE THE ROWS ARE.
--
-- The page read at most a thousand rows and worked its totals out in
-- JavaScript. At launch-day volume that is about a fortnight of traffic; past
-- it the report would have described its first thousand rows as though they
-- were everything — the same silent truncation that once made the AI bill read
-- as half of what was really being spent, and the one thing a report about
-- unanswered students can least afford.
--
-- Definitions, and they live HERE now rather than in the page:
--   dealt with = a paired reply row exists, OR status is answered/replied
--                (login-help settles itself; older replies pre-date pairing)
--   waiting    = not dealt with, and still open
--   ignored    = machine mail. Not a doubt, and not counted either way.

create or replace function public.doubt_report_summary(p_days int default 30, p_channel text default null)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $$
with q as (
  select id, question, page_path, status, created_at
  from page_questions
  where created_at >= now() - make_interval(days => greatest(1, least(180, p_days)))
    and page_path not like 'reply:%'
    -- Facebook notices and marketing pitches are marked ignored on arrival;
    -- counting them let 44 pieces of spam drag the answered percentage down as
    -- though students had been left waiting.
    and status <> 'ignored'
    and (p_channel is null or page_path = p_channel)
),
a as (
  select (regexp_replace(page_path, '^reply:', ''))::uuid as qid, min(created_at) as replied_at
  from page_questions where page_path like 'reply:%' group by 1
),
j as (
  select q.*, a.replied_at,
         (a.replied_at is not null or q.status in ('answered','replied')) as dealt,
         (a.replied_at is null and q.status = 'open') as waiting
  from q left join a on a.qid = q.id
)
select jsonb_build_object(
  'total',    (select count(*) from j),
  'answered', (select count(*) from j where dealt),
  'waiting',  (select count(*) from j where waiting),
  'oldest_wait_mins',
    (select round(extract(epoch from (now() - min(created_at)))/60)::int from j where waiting),
  'median_reply_mins',
    (select round(percentile_cont(0.5) within group (
       order by extract(epoch from (replied_at - created_at))/60))::int
     from j where replied_at is not null and replied_at >= created_at),
  'by_channel', coalesce((
    select jsonb_agg(x order by (x->>'asked')::int desc)
    from (
      select jsonb_build_object(
        'channel', page_path, 'asked', count(*),
        'done', count(*) filter (where dealt),
        'wait', count(*) filter (where waiting)
      ) as x from j group by page_path
    ) t), '[]'::jsonb),
  -- The queue itself, oldest first. Capped: a hundred waiting students is a
  -- crisis to be told about, not a list to scroll.
  'waiting_list', coalesce((
    select jsonb_agg(y order by y->>'created_at')
    from (
      select jsonb_build_object(
        'id', id, 'question', left(question, 300),
        'channel', page_path, 'created_at', created_at
      ) as y from j where waiting order by created_at limit 50
    ) t2), '[]'::jsonb)
);
$$;
