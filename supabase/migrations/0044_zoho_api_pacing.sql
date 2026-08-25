-- PACE OURSELVES TO ZOHO'S PUBLISHED LIMIT INSTEAD OF DISCOVERING IT.
--
-- Zoho Books allows 100 API calls per minute PER ORGANISATION — a hard ceiling
-- on every plan, so Premium buys a bigger daily allowance (10,000) but not a
-- faster minute. Releasing eighteen bills in a run crossed it.
--
-- Counting in the application cannot work: on serverless an in-memory counter
-- is one counter per warm lambda, and a cron firing beside a person pressing
-- "approve all" would each think they were alone. The organisation has ONE
-- budget, so the budget lives in ONE row.
--
-- The ceiling is set at 80 rather than 100 on purpose: his own Zoho browser
-- session and anything else on the account draw from the same allowance, and
-- being refused costs far more than being slightly slow.
create table if not exists public.zoho_api_window (
  id            smallint primary key default 1,
  window_start  timestamptz not null default now(),
  used          integer     not null default 0,
  constraint zoho_api_window_single check (id = 1)
);
insert into public.zoho_api_window (id) values (1) on conflict (id) do nothing;
alter table public.zoho_api_window enable row level security;

create or replace function public.zoho_reserve_call(p_limit integer default 80)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  w  public.zoho_api_window%rowtype;
  ms integer;
begin
  select * into w from public.zoho_api_window where id = 1 for update;
  if now() - w.window_start >= interval '1 minute' then
    update public.zoho_api_window set window_start = now(), used = 1 where id = 1;
    return 0;
  end if;
  if w.used < p_limit then
    update public.zoho_api_window set used = used + 1 where id = 1;
    return 0;
  end if;
  ms := ceil(extract(epoch from (w.window_start + interval '1 minute' - now())) * 1000);
  return greatest(ms, 0);
end;
$$;

grant execute on function public.zoho_reserve_call(integer) to service_role;
