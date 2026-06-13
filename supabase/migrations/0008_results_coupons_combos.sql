-- =====================================================================
-- 121 Coaching — competitive features: results, coupons, combos, test-series
-- Applied via Supabase MCP.
-- =====================================================================

alter table courses add column if not exists is_test_series boolean not null default false;

create table if not exists results (
  id uuid primary key default gen_random_uuid(),
  student_name text not null,
  headline text, attempt text, marks text, photo_url text, quote text,
  order_index int not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);
alter table results enable row level security;
drop policy if exists results_read on results;
drop policy if exists results_admin on results;
create policy results_read on results for select using (is_published or is_admin());
create policy results_admin on results for all using (is_admin()) with check (is_admin());

create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  percent_off int, amount_off_inr int,
  is_active boolean not null default true,
  expires_at timestamptz, max_uses int, used_count int not null default 0,
  created_at timestamptz not null default now()
);
alter table coupons enable row level security;
drop policy if exists coupons_admin on coupons;
create policy coupons_admin on coupons for all using (is_admin()) with check (is_admin());

create table if not exists combos (
  id uuid primary key default gen_random_uuid(),
  title text not null, description text,
  price_inr int not null,
  tier plan_tier not null default 'gold',
  months int not null default 6,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists combo_items (
  combo_id uuid references combos(id) on delete cascade,
  subject_id uuid references subjects(id) on delete cascade,
  primary key (combo_id, subject_id)
);
alter table combos enable row level security;
alter table combo_items enable row level security;
drop policy if exists combos_read on combos;
drop policy if exists combos_admin on combos;
drop policy if exists combo_items_read on combo_items;
drop policy if exists combo_items_admin on combo_items;
create policy combos_read on combos for select using (is_active or is_admin());
create policy combos_admin on combos for all using (is_admin()) with check (is_admin());
create policy combo_items_read on combo_items for select using (true);
create policy combo_items_admin on combo_items for all using (is_admin()) with check (is_admin());
