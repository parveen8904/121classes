-- WHAT AN ADVANCE WAS GIVEN FOR.
--
-- 26 Aug 2026, his instruction: "in relation to advances given to staff, there
-- should be option to give description for that advance."
--
-- Until now an advance was a person, a date and an amount. A month later
-- nobody could say whether ₹10,000 to the office was for couriers, for the
-- printer, or a float before a batch started -- and the person holding it had
-- the same problem, because their own ledger showed a bare number too.
alter table public.petty_advances
  add column if not exists purpose text;

comment on column public.petty_advances.purpose is
  'Why this advance was given. Shown to the recipient on /admin/petty and on the accounts hub.';
