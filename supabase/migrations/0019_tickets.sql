-- Support tickets: full lifecycle for issues raised from the website or logged
-- from phone calls. Each ticket is assigned to a staff member who calls the
-- student; every action is recorded as an event; tickets are resolved/closed
-- and auto-escalate if left unresolved past their SLA window.

create sequence if not exists public.ticket_ref_seq;

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('TKT-' || lpad(nextval('public.ticket_ref_seq')::text, 5, '0')),
  title text not null,
  description text,
  student_name text,
  student_email text,
  student_phone text,
  user_id uuid references auth.users(id) on delete set null,
  source text not null default 'website',    -- website | phone | email | telegram | other
  category text,                              -- payment | access | content | technical | other
  priority text not null default 'normal',   -- low | normal | high | urgent
  status text not null default 'open',        -- open | in_progress | waiting | resolved | closed
  assigned_to uuid references auth.users(id) on delete set null,
  escalate_at timestamptz,                     -- when to escalate if still unresolved
  escalated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz
);

create index if not exists tickets_status_idx on public.tickets(status, created_at desc);
create index if not exists tickets_assigned_idx on public.tickets(assigned_to);
create index if not exists tickets_escalate_idx on public.tickets(escalate_at)
  where escalated = false and status not in ('resolved', 'closed');

create table if not exists public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  kind text not null default 'note',           -- created | note | call | status | assign | escalate | email
  body text,
  created_at timestamptz not null default now()
);

create index if not exists ticket_events_ticket_idx on public.ticket_events(ticket_id, created_at);

-- Server-only tables: deny-all to anon/authenticated. All reads and writes go
-- through server actions on the service-role client (which bypasses RLS), so no
-- policy is added. This matches the other admin-only tables in the project.
alter table public.tickets enable row level security;
alter table public.ticket_events enable row level security;
