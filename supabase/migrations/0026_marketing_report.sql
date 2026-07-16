-- One call powering the Marketing overview dashboard: leads, signups, traffic
-- by source (?src= tags from campaign/ad links), and campaign counts.

create or replace function public.admin_marketing_report()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  wk timestamptz := now() - interval '7 days';
  mo timestamptz := now() - interval '30 days';
begin
  return jsonb_build_object(
    'leads_total',        (select count(*) from leads),
    'leads_week',         (select count(*) from leads where created_at >= wk),
    'leads_verified',     (select count(*) from leads where verified),
    'leads_by_source',    (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                            (select source, count(*) as c from leads group by source order by count(*) desc) t),
    'signups_week',       (select count(*) from auth.users where created_at >= wk),
    'signups_month',      (select count(*) from auth.users where created_at >= mo),
    'signups_by_heard',   (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                            (select coalesce(p.heard_from, '(not asked)') as heard, count(*) as c
                             from profiles p join auth.users u on u.id = p.id
                             where u.created_at >= mo group by p.heard_from order by count(*) desc) t),
    'visits_week',        (select count(distinct coalesce(user_id::text, visitor_key))
                            from page_views where created_at >= wk and event = 'view'),
    'visits_month',       (select count(distinct coalesce(user_id::text, visitor_key))
                            from page_views where created_at >= mo and event = 'view'),
    'traffic_by_src',     (select coalesce(jsonb_agg(t), '[]'::jsonb) from
                            (select substring(path from 'src=([a-zA-Z0-9_]+)') as src,
                                    count(distinct coalesce(user_id::text, visitor_key)) as c
                             from page_views
                             where created_at >= mo and event = 'view' and path like '%src=%'
                             group by 1 order by count(distinct coalesce(user_id::text, visitor_key)) desc) t),
    'campaigns_pending',  (select count(*) from scheduled_posts where status = 'pending'),
    'campaigns_sent_month',(select count(*) from scheduled_posts where status = 'sent' and coalesce(sent_at, send_at) >= mo)
  );
end;
$$;

revoke execute on function public.admin_marketing_report() from anon, authenticated;
