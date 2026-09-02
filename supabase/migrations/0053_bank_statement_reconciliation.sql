-- RECONCILIATION REPLACES THE CONTINUITY CHECK.
--
-- His instruction, 2 September 2026: "why you need continuity break. I may
-- keep on uploading any statement from any start date. You have to
-- reconciliation and find missing entries."
--
-- Continuity asked whether this statement's opening balance equalled the
-- previous statement's closing. That test assumes statements arrive in an
-- unbroken chain, which is not how they arrive: a fortnight is re-sent after a
-- wrong entry is deleted, a quarter is pulled to check one payment, a single
-- month is uploaded on its own. Every one of those raised "continuity break"
-- on a file with nothing wrong with it, and the warning could not name a
-- single line either way.
--
-- What is worth knowing is the difference against the books themselves, which
-- is now computed on every upload out of the register we already fetch:
--
--   recon_missing  lines in the statement with no entry in Zoho -- money that
--                  still needs booking
--   recon_extra    entries in Zoho for this period with no line in the
--                  statement -- a wrong entry, or a statement never uploaded
--
-- continuity_ok stays on the table so the statements already uploaded keep
-- their history, but nothing computes or reads it any more.
alter table public.bank_statements
  add column if not exists recon_missing integer,
  add column if not exists recon_extra integer;

comment on column public.bank_statements.recon_missing is
  'Lines in this statement with no matching entry in the Zoho bank register for the same period.';
comment on column public.bank_statements.recon_extra is
  'Entries in the Zoho bank register for this period with no matching line in this statement.';
comment on column public.bank_statements.continuity_ok is
  'RETIRED 2 Sep 2026. Opening-vs-previous-closing check, replaced by recon_missing / recon_extra. Kept for the statements that carry it.';
