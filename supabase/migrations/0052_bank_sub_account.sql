-- A SUB-ACCOUNT ON A BANK LINE.
--
-- 26 Aug 2026, his instruction: "in bank journal give us option to make sub
-- account."
--
-- The same idea a supplier bill already carries. It is not a separate ledger in
-- Zoho -- it is the qualifier that says WHICH of a thing the entry is: Courier
-- Expenses (Delhi office), Rent (Nirman Vihar). It reads on the ledger line,
-- which is all the auditor and the department ever see of an entry, and until
-- now a bank line could only name the head and nothing finer.
--
-- Kept on the rule as well, so a merchant answered once repeats with its
-- sub-account and he is not typing it every month.
alter table public.bank_lines
  add column if not exists sub_account text;

alter table public.merchant_rules
  add column if not exists sub_account text;

comment on column public.bank_lines.sub_account is
  'Optional qualifier shown on the Zoho ledger line, e.g. "Delhi office". Not a separate Zoho account.';
