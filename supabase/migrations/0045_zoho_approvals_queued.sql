-- HIS APPROVAL SHOULD ONLY EVER BE NEEDED ONCE.
--
-- Zoho allows 100 calls a minute per organisation and a posting costs several,
-- so a long queue cannot all go at once. The ones that did not fit used to stay
-- `pending`, so he had to press approve again — the system asking him to do its
-- waiting for it.
--
-- `queued` records the thing that matters: HE HAS ALREADY SAID YES. The row
-- carries who decided it and when, exactly as an approved one does; all that
-- remains is capacity. /api/cron/zoho-drain empties it a minute at a time.
--
-- This does not weaken the rule that nothing posts without his approval. A row
-- only becomes `queued` from a release he performed, and the drain posts it
-- through the same releaseApproval path behind the same guard.
alter table public.zoho_approvals
  add column if not exists queued_at timestamptz;

comment on column public.zoho_approvals.queued_at is
  'Set when he released it but Zoho''s per-minute limit was spent. The drain cron posts it; his approval is not asked for again.';

create index if not exists zoho_approvals_queued_idx
  on public.zoho_approvals (queued_at)
  where status = 'queued';
