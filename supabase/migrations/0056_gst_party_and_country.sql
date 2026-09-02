-- THE GST-REGISTERED NAME, AND ADDRESSES THAT ARE NOT IN INDIA.
--
-- Ravi's spec, 2 September 2026 ("Required Development Changes"):
--
--   "Add an optional GST Number field and a separate Trade/Legal Name field...
--    Trade/Legal Name should appear exactly as registered in GST records,
--    including capitalization, small letters, spacing and spelling."
--   "Add Country field with India / Other Country options."
--
-- WHY A SEPARATE COLUMN RATHER THAN REUSING business_name. business_name is
-- what the buyer calls themselves; legal_name and trade_name are what the GST
-- register says, character for character. They are different facts and one
-- overwrites the other the moment a verification runs, so an edit by a student
-- must not be able to silently pass itself off as a fetched record. gst_fetched_at
-- says whether these came from the register or from a keyboard.
alter table public.profiles
  add column if not exists trade_name text,
  add column if not exists legal_name text,
  add column if not exists gst_fetched_at timestamptz,
  add column if not exists country text;

comment on column public.profiles.trade_name is
  'Trade name EXACTLY as the GST register returns it. Never typed by hand; set only by a verified fetch.';
comment on column public.profiles.legal_name is
  'Legal name exactly as the GST register returns it.';
comment on column public.profiles.gst_fetched_at is
  'When the GST register was last read for this GSTIN. Null means the number was only checksum-verified, never fetched.';
comment on column public.profiles.country is
  'India, or the country of an address outside it. Books are couriered inside India only; a foreign address is a BILLING address.';
