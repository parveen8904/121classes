-- Marketing leads: contacts captured OUTSIDE the normal signup — CSV imports
-- (e.g. Interakt/WhatsApp contact exports), numbers collected on calls, and the
-- free-planner landing page. Leads join the WhatsApp campaign audience and the
-- IVR ticket webhook recognises them by phone. matched_user_id links a lead to
-- a real student account once one exists.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text,            -- normalized 10-digit Indian mobile
  email text,
  level text,            -- interest, e.g. CA Inter / CA Final (free text)
  source text not null default 'csv',   -- csv | interakt | whatsapp | youtube | landing | manual | other
  note text,
  matched_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists leads_phone_idx on public.leads(phone);
create index if not exists leads_email_idx on public.leads(email);

-- Server-only table (deny-all RLS; service-role access from server actions).
alter table public.leads enable row level security;
