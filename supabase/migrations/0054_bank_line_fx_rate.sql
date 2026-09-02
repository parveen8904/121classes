-- THE RATE, WHEN A RUPEE PAYMENT SETTLES A FOREIGN BILL.
--
-- His ask, 2 September 2026, on the reconciliation suggestions: "Each
-- suggestion should give choice to select ledger and amount and dollar rate if
-- any. It should match with vendor payment or make rules for future."
--
-- A supplier billed in USD owes $1,200. The Axis account shows ₹1,03,440
-- leaving. Applying 103440 against a bill that owes 1200 is not a rounding
-- argument, it is nonsense -- so the rate has to be recorded on the line and
-- carried into the vendor payment, where Zoho uses it to work out its own
-- exchange difference.
alter table public.bank_lines
  add column if not exists fx_rate numeric,
  add column if not exists match_currency text;

comment on column public.bank_lines.fx_rate is
  'Rupees per unit of the matched document''s currency. Required before a non-INR bill or invoice can be settled from this line.';
comment on column public.bank_lines.match_currency is
  'Currency of the open document this line was matched to, so the desk is asked for a rate only when there is one to ask for.';
