-- THE MONEY, ON THE DASHBOARD, COUNTED THE WAY ACCOUNTS COUNTS IT.
--
-- Two rules this obeys, both learned the hard way in this codebase:
--
--   · SPONSORSHIPS ARE REVENUE. gift_orders is where a supporter's purchase
--     lands, and leaving it out is exactly what made the sales report say
--     ₹98,000 while Accounts said ₹1,33,000 for the same day.
--
--   · "PAID" MEANS THE SAME EVERYWHERE. paid | provisioned | dispatched |
--     delivered — matching ACCOUNT_STATES in lib/accountsExport.ts.
--     book_orders.status is an ENUM WITHOUT `provisioned`, so it is asked only
--     for the three values that type can hold — asking an enum for a value it
--     lacks is a type error that rejects the whole query, not an empty result.
--
-- Aggregated in the database on purpose: summing rows in the page would be cut
-- off at PostgREST's 1,000-row cap and quietly under-report.
create or replace function public.admin_dashboard_money()
returns table (
  revenue_all       numeric,
  revenue_month     numeric,
  revenue_today     numeric,
  users_today       bigint,
  subscriptions_today bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with bounds as (
    select
      date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date as m_start,
      (now() at time zone 'Asia/Kolkata')::date                      as d_start
  ),
  paid as (
    select amount_inr, created_at from orders
      where status::text in ('paid','provisioned','dispatched','delivered')
    union all
    select amount_inr, created_at from gift_orders
      where status::text in ('paid','provisioned','dispatched','delivered')
    union all
    select amount_inr, created_at from book_orders
      where status::text in ('paid','dispatched','delivered')
  )
  select
    coalesce(sum(p.amount_inr), 0),
    coalesce(sum(p.amount_inr) filter (
      where (p.created_at at time zone 'Asia/Kolkata')::date >= (select m_start from bounds)), 0),
    coalesce(sum(p.amount_inr) filter (
      where (p.created_at at time zone 'Asia/Kolkata')::date = (select d_start from bounds)), 0),
    (select count(*) from profiles
       where role = 'student'
         and (created_at at time zone 'Asia/Kolkata')::date = (select d_start from bounds)),
    -- A subscription SOLD today: a paid subscription order placed today. Counted
    -- from orders rather than the subscriptions table, because a row there can
    -- be created by a renewal or an admin grant that no money passed through.
    (select count(*) from orders
       where status::text in ('paid','provisioned','dispatched','delivered')
         and (created_at at time zone 'Asia/Kolkata')::date = (select d_start from bounds))
  from paid p;
$function$;

grant execute on function public.admin_dashboard_money() to service_role;
