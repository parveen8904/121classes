-- Visitor report v2: the daily activity list now shows EVERY visitor (not just
-- logged-in students) — anonymous browsers appear as unnamed rows — ordered by
-- time spent, and includes the phone number for known students.

create or replace function public.admin_visitor_report()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
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
    -- Logged-in students: name, email, phone.
    select p.full_name as name,
           au.email,
           p.phone,
           to_char(min(v.created_at) at time zone 'Asia/Kolkata', 'HH12:MI AM') as first_seen,
           to_char(max(v.created_at) at time zone 'Asia/Kolkata', 'HH12:MI AM') as last_seen,
           greatest(1, round(extract(epoch from (max(v.created_at) - min(v.created_at))) / 60))::int as minutes,
           count(*) filter (where v.event = 'view') as pages
    from page_views v
    join profiles p on p.id = v.user_id
    left join auth.users au on au.id = v.user_id
    where v.created_at >= day_start and v.user_id is not null
    group by p.full_name, au.email, p.phone
    union all
    -- Anonymous visitors: one row per browser key; no identity until they
    -- verify through the popup / register.
    select null, null, null,
           to_char(min(created_at) at time zone 'Asia/Kolkata', 'HH12:MI AM'),
           to_char(max(created_at) at time zone 'Asia/Kolkata', 'HH12:MI AM'),
           greatest(1, round(extract(epoch from (max(created_at) - min(created_at))) / 60))::int,
           count(*) filter (where event = 'view')
    from page_views
    where created_at >= day_start and user_id is null
      and visitor_key is not null and visitor_key <> ''
    group by visitor_key
    order by 6 desc, 7 desc
    limit 300) u;

  return jsonb_build_object(
    'day_start_ist', day_start,
    'visitors_today', (select count(distinct coalesce(user_id::text, visitor_key)) from page_views where created_at >= day_start and event = 'view'),
    'visitors_7d', (select count(distinct coalesce(user_id::text, visitor_key)) from page_views where created_at >= week_start and event = 'view'),
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
$$;

revoke execute on function public.admin_visitor_report() from anon, authenticated;
