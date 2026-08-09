-- "Visitors today" with nothing to measure it against.
--
-- The health page showed how many people came today and in the last seven
-- days, but never how many have ever come. So a good day and a bad day looked
-- the same, and there was no way to say whether the site is growing.
--
-- The running total is added here rather than fetched separately, so the page
-- still makes ONE call for the whole visitor report. The date tracking began is
-- returned with it, because a lifetime figure means nothing without knowing
-- when the counting started — this is 14 July 2026, not the beginning of time.

create or replace function public.admin_visitor_report()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  week_start timestamptz := now() - interval '7 days';
  top_pages jsonb;
  activity jsonb;
begin
  select jsonb_agg(t) into top_pages from (
    select path, count(*) as views,
           count(distinct coalesce(user_id::text, visitor_key)) as visitors
    from page_views
    where created_at >= day_start and event = 'view' and path not like '/admin%'
    group by path order by count(*) desc limit 12) t;

  select jsonb_agg(u) into activity from (
    with ev as (
      select user_id, visitor_key, created_at, event,
             case when created_at - lag(created_at) over (partition by coalesce(user_id::text, visitor_key) order by created_at) <= interval '30 minutes'
                  then extract(epoch from created_at - lag(created_at) over (partition by coalesce(user_id::text, visitor_key) order by created_at))
                  else null end as gap_s
      from page_views
      where created_at >= day_start
        and (user_id is not null or (visitor_key is not null and visitor_key <> ''))
    ),
    agg as (
      select coalesce(user_id::text, visitor_key) as who, user_id,
             min(created_at) as mn, max(created_at) as mx,
             greatest(1, round(coalesce(sum(gap_s), 0) / 60) + count(*) filter (where gap_s is null))::int as minutes,
             count(*) filter (where gap_s is null) as visits,
             count(*) filter (where event = 'view') as pages
      from ev group by 1, 2
    )
    select p.full_name as name,
           au.email,
           p.phone,
           coalesce(
             (select string_agg(distinct case when c.title ilike '%final%' then 'Final'
                                              when c.title ilike '%inter%' then 'Inter'
                                              else c.title end, ' + ')
                from my_courses mc join courses c on c.id = mc.course_id
               where mc.student_id = a.user_id),
             (select string_agg(distinct case when c.title ilike '%final%' then 'Final'
                                              when c.title ilike '%inter%' then 'Inter'
                                              else c.title end, ' + ')
                from subscriptions sub join courses c on c.id = sub.course_id
               where sub.student_id = a.user_id),
             '—') as level,
           to_char(a.mn at time zone 'Asia/Kolkata', 'HH12:MI AM') as first_seen,
           to_char(a.mx at time zone 'Asia/Kolkata', 'HH12:MI AM') as last_seen,
           a.mx as last_at,
           a.minutes, a.visits, a.pages
    from agg a
    left join profiles p on p.id = a.user_id
    left join auth.users au on au.id = a.user_id
    order by a.minutes desc, a.pages desc
    limit 300) u;

  return jsonb_build_object(
    'day_start_ist', day_start,
    'visitors_today', (select count(distinct coalesce(user_id::text, visitor_key)) from page_views where created_at >= day_start and event = 'view'),
    'visitors_7d', (select count(distinct coalesce(user_id::text, visitor_key)) from page_views where created_at >= week_start and event = 'view'),
    -- Everyone who has ever come, and every page they have ever opened.
    'visitors_total', (select count(distinct coalesce(user_id::text, visitor_key)) from page_views where event = 'view'),
    'views_total', (select count(*) from page_views where event = 'view'),
    'tracking_since', (select min(created_at) from page_views),
    'views_today', (select count(*) from page_views where created_at >= day_start and event = 'view'),
    'signed_in_today', (select count(distinct user_id) from page_views where created_at >= day_start and user_id is not null),
    'login_success_today', (select count(*) from page_views where created_at >= day_start and event = 'login_success'),
    'login_failed_today', (select count(*) from page_views where created_at >= day_start and event = 'login_failed'),
    'signup_success_today', (select count(*) from page_views where created_at >= day_start and event = 'signup_success'),
    'signup_failed_today', (select count(*) from page_views where created_at >= day_start and event = 'signup_failed'),
    'new_accounts_today', (select count(*) from auth.users where created_at >= day_start),
    'top_pages', coalesce(top_pages, '[]'::jsonb),
    'activity', coalesce(activity, '[]'::jsonb)
  );
end;
$function$;
