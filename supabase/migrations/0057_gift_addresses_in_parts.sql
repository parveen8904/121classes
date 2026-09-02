-- THE SPONSOR'S AND THE RECIPIENT'S ADDRESSES, IN PARTS.
--
-- Ravi's spec, 2 September 2026, two Medium items:
--
--   "Student - Sponsor / Recipient: Recipient section currently has only one
--    Address field. Add separate fields for Address, City, State and PIN Code."
--   "Student - Sponsor Billing: Sponsor Billing section currently has only one
--    Address field... These details should be maintained separately and used
--    for the Sponsor's invoice/billing."
--
-- Both were free-text areas, which is fine to print and impossible to use: the
-- warehouse cannot sort a paragraph by pincode, and looksPostableInIndia had to
-- guess at whether a blob of text was even in the country.
--
-- The existing recipient_address and billing_address text columns are KEPT and
-- still written, so every screen, email and label that reads them carries on
-- working; these hold the same address in parts, in the shape of lib/address.ts.
alter table public.gift_orders
  add column if not exists recipient_addr jsonb,
  add column if not exists billing_addr jsonb;

comment on column public.gift_orders.recipient_addr is
  'Where the books go: the STUDENT''s address, in parts. The text column keeps the same address as one line.';
comment on column public.gift_orders.billing_addr is
  'Who the invoice is made out to: the SPONSOR''s own address, in parts. Deliberately separate from the recipient''s.';
