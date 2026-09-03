-- WHOSE DOCUMENT IS THIS?
--
-- "Supplier name, not visible." — 3 September 2026, with the vault open on a
-- supplier invoice showing thirteen rows of line items and no clue whose they
-- were. The readers were all written to get a TABLE out of a file, because they
-- were written for bank statements; on an invoice the one fact needed to file
-- it sits in the letterhead, which nothing looked at.
--
-- These four are what the document says about ITSELF, read once on the way in
-- and kept beside it. They are a PROPOSAL: the vault shows them and fills the
-- party box with them, and a person confirms or changes it before anything is
-- filed. Nothing posts off the back of them.
alter table public.zoho_vault_docs
  add column if not exists party_guess text,
  add column if not exists party_gstin text,
  add column if not exists doc_no       text,
  add column if not exists doc_date     date;

comment on column public.zoho_vault_docs.party_guess is
  'Who the document says issued it — read from the letterhead. A proposal a person confirms, never used to post.';
comment on column public.zoho_vault_docs.party_gstin is
  'The issuer''s GSTIN as printed, where there is one.';
