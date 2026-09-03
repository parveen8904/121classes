-- WHAT THE DESK DECIDES, NOT ONLY WHAT THE STATEMENT SAID.
--
-- His instruction, 3 September 2026:
--
--   "There is no choice of putting narration from ourselves. There is no
--    choice when you ask that whether it's income expense, if it is Vendor
--    payment, we should be able to process it as Vendor payment or customer
--    payment, and we should be able to generalise the entry on ourselves if
--    your entry is incorrect. If something else has to be debited or something
--    else has to be created. Please make it flexible."
--
-- Until now a bank line could only be answered with ONE thing: which ledger
-- the contra side is. Everything else — which way the money went, what kind of
-- document it becomes in Zoho, whose payment it is, and what the entry says in
-- words — was decided by the parser and could not be argued with. When the
-- parser was wrong (see the two ₹6,900 receipts filed as payments) there was
-- no way to put it right except to skip the line.
--
-- These four columns are the human's answers. Each is NULL until somebody
-- overrides, so a line nobody has touched behaves exactly as it did before.

alter table public.bank_lines
  -- 'in' | 'out'. Overrides the parsed debit/credit columns. The figures
  -- themselves are never rewritten — the statement is the statement — this
  -- only says which way it is to be booked.
  add column if not exists direction text,

  -- His own words for the entry. The bank's string ("NEFT/PUNBH26230923/131/
  -- SANGRUP BRANCH OF NIRC OF IC") is kept as the source underneath, never
  -- replaced, because it is the evidence.
  add column if not exists own_narration text,

  -- What Zoho document this becomes:
  --   auto             — as before: an Expense if money out to an expense
  --                      head, otherwise a journal
  --   expense / income — force the P&L treatment
  --   vendor_payment   — money out to a supplier (an advance when it settles
  --                      no particular bill)
  --   customer_payment — money in from a customer
  --   journal          — a plain journal, whatever the contra head is
  add column if not exists entry_kind text,

  -- The supplier or customer, for the two payment kinds. Matched to a Zoho
  -- contact by name when the entry is posted, and created if there is none.
  add column if not exists party_name text;

alter table public.bank_lines
  drop constraint if exists bank_lines_direction_check;
alter table public.bank_lines
  add constraint bank_lines_direction_check
  check (direction is null or direction in ('in', 'out'));

alter table public.bank_lines
  drop constraint if exists bank_lines_entry_kind_check;
alter table public.bank_lines
  add constraint bank_lines_entry_kind_check
  check (entry_kind is null or entry_kind in
    ('auto', 'expense', 'income', 'vendor_payment', 'customer_payment', 'journal'));

comment on column public.bank_lines.direction is
  'in | out — a human''s correction of the parsed direction. The debit/credit figures are left as the statement printed them.';
comment on column public.bank_lines.own_narration is
  'The desk''s own wording for the entry. The bank''s own string is kept underneath it as the source.';
comment on column public.bank_lines.entry_kind is
  'Which Zoho document this line becomes. NULL or auto = the old behaviour.';
comment on column public.bank_lines.party_name is
  'Supplier or customer, for entry_kind vendor_payment / customer_payment.';
