-- A SUBSCRIPTION SOLD BY A VENDOR IS STILL A SUBSCRIPTION SOLD.
--
-- "today a total of 4 subscriptions have been sold, but the dashboard is
-- showing only 1 ... vendors are not being counted" — the team, 4 September
-- 2026. The same function already knew better: the revenue lines union
-- gift_orders in under "SPONSORSHIPS ARE REVENUE", learned when the sales
-- report said Rs 98,000 against Accounts' Rs 1,33,000. The COUNT beneath them
-- was never given the same treatment, so the money included the vendors and
-- the tally did not — one dashboard disagreeing with itself.
--
-- Measured when this was written: 1 direct order, 5 vendor orders, tile read 1.
-- book_orders stays out: a book is a parcel, not a subscription.
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
  ),
  -- Every way a subscription is sold: bought directly, or bought for a student
  -- by a vendor or sponsor. Counted from the ORDER, not the subscriptions
  -- table, because a row there can also be a renewal or an admin grant that no
  -- money passed through.
  subs_sold as (
    select created_at from orders
      where status::text in ('paid','provisioned','dispatched','delivered')
    union all
    select created_at from gift_orders
      where status::text in ('paid','provisioned','dispatched','delivered')
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
    (select count(*) from subs_sold
       where (created_at at time zone 'Asia/Kolkata')::date = (select d_start from bounds))
  from paid p;
$function$;

grant execute on function public.admin_dashboard_money() to service_role;
