-- =====================================================================
-- 121 Coaching — initial schema (Phase 1 Foundation)
-- Run in Supabase: SQL Editor → paste → Run (or via the Supabase CLI).
-- Mirrors docs/PORTAL_SPEC.md §7. RLS is enabled on every table.
-- =====================================================================

-- ---------- Enums ----------
create type user_role          as enum ('student', 'admin', 'faculty');
create type plan_tier          as enum ('bronze', 'silver', 'gold');
create type section_type       as enum (
  'ask_doubt','revision_video','full_class_video','live_class',
  'pdf','mcq_test','subjective_test','past_papers','rich_text','custom'
);
create type sub_status         as enum ('active','expired','cancelled');
create type sub_channel        as enum ('web','ios','android','admin_grant');
create type order_kind         as enum ('subscription','book');
create type book_order_status  as enum ('paid','dispatched','delivered','cancelled');
create type announcement_kind  as enum ('amendment','whats_new','student_corner','industry','macro');
create type notif_channel      as enum ('whatsapp','email');

-- ---------- Profiles (1:1 with auth.users) ----------
create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text,
  email          text,
  phone          text,
  role           user_role not null default 'student',
  target_attempt text,
  created_at     timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, phone, full_name)
  values (new.id, new.email, new.phone,
          coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Helper functions ----------
create function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create function public.plan_rank(t plan_tier)
returns int language sql immutable as $$
  select case t when 'bronze' then 1 when 'silver' then 2 when 'gold' then 3 end;
$$;

-- True if the current user has an active subscription to `course`
-- at or above the `needed` tier (or `needed` is null = free content).
create function public.has_course_access(course uuid, needed plan_tier)
returns boolean language sql stable security definer set search_path = public as $$
  select needed is null or exists (
    select 1
    from subscriptions s
    join plans p on p.id = s.plan_id
    where s.student_id = auth.uid()
      and s.course_id  = course
      and s.status     = 'active'
      and now() between s.starts_at and s.ends_at
      and plan_rank(p.tier) >= plan_rank(needed)
  );
$$;

-- ---------- Content hierarchy ----------
create table courses (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  slug         text unique,
  order_index  int  not null default 0,
  is_published boolean not null default false
);

create table subjects (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references courses(id) on delete cascade,
  title        text not null,
  slug         text,
  order_index  int  not null default 0
);

create table faculties (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  photo_url  text,
  bio        text
);

create table subject_faculty (
  subject_id uuid references subjects(id) on delete cascade,
  faculty_id uuid references faculties(id) on delete cascade,
  primary key (subject_id, faculty_id)
);

create table topics (
  id                 uuid primary key default gen_random_uuid(),
  subject_id         uuid not null references subjects(id) on delete cascade,
  title              text not null,
  slug               text,
  order_index        int  not null default 0,
  valid_from_attempt text,
  valid_to_attempt   text,
  amendments_upto    text,
  is_published       boolean not null default false
);

create table sections (
  id           uuid primary key default gen_random_uuid(),
  topic_id     uuid not null references topics(id) on delete cascade,
  type         section_type not null,
  title        text not null,                 -- admin-defined (custom sections any name)
  order_index  int  not null default 0,
  min_plan     plan_tier,                     -- null = free
  config       jsonb not null default '{}',
  is_published boolean not null default false
);

-- ---------- Tests ----------
create table mcq_questions (
  id            uuid primary key default gen_random_uuid(),
  section_id    uuid not null references sections(id) on delete cascade,
  question      text not null,
  options       jsonb not null,
  correct_index int  not null,
  order_index   int  not null default 0
);

create table mcq_attempts (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  section_id uuid not null references sections(id) on delete cascade,
  score      int, total int, answers jsonb,
  created_at timestamptz not null default now()
);

create table subjective_questions (
  id         uuid primary key default gen_random_uuid(),
  section_id uuid not null references sections(id) on delete cascade,
  prompt     text not null,
  max_marks  int
);

create table subjective_submissions (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references profiles(id) on delete cascade,
  question_id uuid not null references subjective_questions(id) on delete cascade,
  answer_text text,
  ai_score    int,
  ai_feedback text,
  status      text default 'submitted',
  created_at  timestamptz not null default now()
);

-- ---------- Plans, subscriptions, orders ----------
create table plans (
  id            uuid primary key default gen_random_uuid(),
  tier          plan_tier not null,
  name          text not null,
  rank          int not null default 0,
  web_price_inr int,            -- per-month base; duration scaling handled in app
  app_price_inr int,            -- ~130-140% of web
  features      jsonb not null default '{}',
  is_active     boolean not null default true
);

create table subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references profiles(id) on delete cascade,
  course_id          uuid not null references courses(id) on delete cascade,
  plan_id            uuid not null references plans(id),
  channel            sub_channel not null default 'web',
  starts_at          timestamptz not null default now(),
  ends_at            timestamptz not null,
  status             sub_status  not null default 'active',
  auto_renew         boolean not null default true,
  granted_by_admin_id uuid references profiles(id),
  created_at         timestamptz not null default now()
);

create table orders (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid references profiles(id) on delete set null,
  kind             order_kind not null,
  ref_id           uuid,
  channel          sub_channel not null default 'web',
  razorpay_order_id text,
  store_txn_id     text,
  amount_inr       int,
  status           text not null default 'created',
  created_at       timestamptz not null default now()
);

-- ---------- Commerce: books ----------
create table books (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  author      text,
  description text,
  cover_url   text,
  price_inr   int not null,
  stock_qty   int not null default 0,
  is_active   boolean not null default true
);

create table book_orders (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid references profiles(id) on delete set null,
  guest_contact      jsonb,                   -- {name, phone, email} for guest checkout
  items              jsonb not null,
  amount_inr         int not null,
  razorpay_order_id  text,
  ship_to            jsonb not null,
  status             book_order_status not null default 'paid',
  warehouse_notified_at timestamptz,
  created_at         timestamptz not null default now()
);

-- ---------- Live, messaging, content ----------
create table live_sessions (
  id                  uuid primary key default gen_random_uuid(),
  section_id          uuid references sections(id) on delete cascade,
  zoom_webinar_id     text,
  starts_at           timestamptz,
  join_url            text,
  recording_bunny_id  text
);

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid references profiles(id) on delete cascade,
  channel    notif_channel not null,
  template   text,
  payload    jsonb,
  status     text default 'queued',
  sent_at    timestamptz
);

create table announcements (
  id           uuid primary key default gen_random_uuid(),
  kind         announcement_kind not null,
  title        text not null,
  body         text,
  link_url     text,
  published_at timestamptz default now(),
  is_published boolean not null default true
);

create table doubts (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  section_id uuid references sections(id) on delete set null,
  question   text not null,
  ai_answer  text,
  status     text default 'open',
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Row-Level Security
-- =====================================================================
alter table profiles               enable row level security;
alter table courses                enable row level security;
alter table subjects               enable row level security;
alter table faculties              enable row level security;
alter table subject_faculty        enable row level security;
alter table topics                 enable row level security;
alter table sections               enable row level security;
alter table mcq_questions          enable row level security;
alter table mcq_attempts           enable row level security;
alter table subjective_questions   enable row level security;
alter table subjective_submissions enable row level security;
alter table plans                  enable row level security;
alter table subscriptions          enable row level security;
alter table orders                 enable row level security;
alter table books                  enable row level security;
alter table book_orders            enable row level security;
alter table live_sessions          enable row level security;
alter table notifications          enable row level security;
alter table announcements          enable row level security;
alter table doubts                 enable row level security;

-- Profiles: read/update own; admins manage all.
create policy profiles_self_read   on profiles for select using (id = auth.uid() or is_admin());
create policy profiles_self_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all   on profiles for all    using (is_admin()) with check (is_admin());

-- Public catalogue (published) readable by anyone; admins write.
create policy courses_read   on courses   for select using (is_published or is_admin());
create policy courses_admin  on courses   for all    using (is_admin()) with check (is_admin());
create policy subjects_read  on subjects  for select using (
  is_admin() or exists (select 1 from courses c where c.id = course_id and c.is_published));
create policy subjects_admin on subjects  for all using (is_admin()) with check (is_admin());
create policy faculties_read on faculties for select using (true);
create policy faculties_admin on faculties for all using (is_admin()) with check (is_admin());
create policy sf_read  on subject_faculty for select using (true);
create policy sf_admin on subject_faculty for all using (is_admin()) with check (is_admin());
create policy topics_read  on topics for select using (is_published or is_admin());
create policy topics_admin on topics for all using (is_admin()) with check (is_admin());

-- Sections: published + (free OR the user has the required course access).
create policy sections_read on sections for select using (
  is_admin() or (
    is_published and (
      min_plan is null or
      has_course_access(
        (select s.course_id from subjects s
           join topics t on t.subject_id = s.id where t.id = topic_id),
        min_plan)
    )
  )
);
create policy sections_admin on sections for all using (is_admin()) with check (is_admin());

-- Plans + announcements + books: public read, admin write.
create policy plans_read  on plans  for select using (is_active or is_admin());
create policy plans_admin on plans  for all using (is_admin()) with check (is_admin());
create policy ann_read    on announcements for select using (is_published or is_admin());
create policy ann_admin   on announcements for all using (is_admin()) with check (is_admin());
create policy books_read  on books  for select using (is_active or is_admin());
create policy books_admin on books  for all using (is_admin()) with check (is_admin());

-- Tests content follows section access; attempts/submissions are per-student.
create policy mcqq_read   on mcq_questions for select using (is_admin() or exists (
  select 1 from sections sec where sec.id = section_id));   -- gating enforced on section read
create policy mcqq_admin  on mcq_questions for all using (is_admin()) with check (is_admin());
create policy mcqa_own    on mcq_attempts for all using (student_id = auth.uid() or is_admin())
  with check (student_id = auth.uid());
create policy subq_read   on subjective_questions for select using (true);
create policy subq_admin  on subjective_questions for all using (is_admin()) with check (is_admin());
create policy subs_own    on subjective_submissions for all using (student_id = auth.uid() or is_admin())
  with check (student_id = auth.uid());

-- Subscriptions / orders: students see own; admins manage all (incl. grants).
create policy subsr_own   on subscriptions for select using (student_id = auth.uid() or is_admin());
create policy subsr_admin on subscriptions for all using (is_admin()) with check (is_admin());
create policy orders_own  on orders for select using (student_id = auth.uid() or is_admin());
create policy orders_admin on orders for all using (is_admin()) with check (is_admin());

-- Book orders: a logged-in buyer sees own; admins all. (Guest orders via server role.)
create policy bo_own   on book_orders for select using (student_id = auth.uid() or is_admin());
create policy bo_admin on book_orders for all using (is_admin()) with check (is_admin());

-- Live sessions readable to authenticated users; admin write.
create policy live_read  on live_sessions for select using (auth.uid() is not null);
create policy live_admin on live_sessions for all using (is_admin()) with check (is_admin());

-- Notifications + doubts: per-student; admin all.
create policy notif_own  on notifications for select using (student_id = auth.uid() or is_admin());
create policy notif_admin on notifications for all using (is_admin()) with check (is_admin());
create policy doubts_own on doubts for all using (student_id = auth.uid() or is_admin())
  with check (student_id = auth.uid());

-- =====================================================================
-- Seed: a starter set of plans (prices are placeholders — edit in admin).
-- =====================================================================
insert into plans (tier, name, rank, web_price_inr, app_price_inr, features) values
  ('bronze', 'Bronze', 1,  499,  699, '{"revision_video":true,"full_class_video":false,"pdf":true,"ask_doubt":false,"subjective_test":false}'),
  ('silver', 'Silver', 2,  999, 1399, '{"revision_video":true,"full_class_video":false,"pdf":true,"ask_doubt":true,"subjective_test":true}'),
  ('gold',   'Gold',   3, 1499, 2099, '{"revision_video":true,"full_class_video":true,"pdf":true,"ask_doubt":true,"subjective_test":true,"live_class":true}');
