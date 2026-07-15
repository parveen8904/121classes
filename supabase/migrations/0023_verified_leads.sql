-- Verified lead capture: the case-scenario teaser popup collects email + phone
-- and confirms BOTH (email code + WhatsApp OTP) before unlocking the free case
-- test — so captured contact data is real. Also: repository items can be marked
-- as public free samples (gated behind the same verification).

alter table public.leads add column if not exists verified boolean not null default false;

create table if not exists public.lead_verifications (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  email text,
  phone text,
  email_code text,
  phone_code text,             -- null when WhatsApp OTP couldn't be sent
  email_verified boolean not null default false,
  phone_verified boolean not null default false,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes')
);

create index if not exists lead_verif_email_idx on public.lead_verifications(email, created_at);
create index if not exists lead_verif_phone_idx on public.lead_verifications(phone, created_at);

alter table public.lead_verifications enable row level security;

-- Free public samples (question banks / papers) shown on the try page.
alter table public.repository_items add column if not exists public_sample boolean not null default false;
