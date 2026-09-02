-- BILLING AND SHIPPING, HELD ON THE PROFILE AND ON THE ORDER.
--
-- His instruction, 2 September 2026: "whenever any student is ordering or any
-- vendor or supporter is ordering any product, you have to ask the billing
-- address as well as the shipping address and you will post these addresses to
-- the profile... In case of supporters and vendors they will have a different
-- profile and profile address. The billing address will be of the vendor and
-- the shipping address will be of the student." And on the fields themselves:
-- "pin code and selection of the state and everything in separate rows like a
-- professional address book... landmark also as an option... choice of telling
-- whether the billing address and shipping address is same so that he has not
-- to fill the address again... and GST number."
--
-- Until now the checkout took ONE flat block and the profile held no address at
-- all, so every order was typed from nothing and nothing could be prefilled.
--
-- Held as jsonb in the shape of lib/address.ts -- name, line1, line2, landmark,
-- city, state, pincode, country, phone -- which is the same shape book_orders
-- already stores in ship_to, so nothing has to be converted.
-- The BILLING address already lived here as address_line1/2, city, state,
-- pincode, gstin, business_name, and lib/orderInvoice.ts reads those columns to
-- decide CGST+SGST against IGST. Adding a jsonb copy would be two sources of
-- truth for one fact, which is how an invoice comes to disagree with a profile.
-- So only the SHIPPING address is new: the profile never held one at all, which
-- is why every book order was typed from nothing.
alter table public.profiles
  add column if not exists shipping_address jsonb;

alter table public.book_orders
  add column if not exists bill_to jsonb,
  add column if not exists gstin text;

comment on column public.profiles.shipping_address is
  'Where parcels go, in the shape of lib/address.ts. Prefills the checkout; the checkout writes back to it. The BILLING address is the flat address_line1/2, city, state, pincode columns, which the invoice reads.';
comment on column public.book_orders.bill_to is
  'The billing address AS AT THE ORDER. Never read back from the profile, which may change later -- an invoice must keep saying what it said.';
comment on column public.book_orders.gstin is
  'The buyer''s GST number as at the order, for the tax invoice.';
