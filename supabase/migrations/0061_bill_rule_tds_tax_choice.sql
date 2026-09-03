-- WHICH OF ZOHO'S TDS RATES THIS SUPPLIER'S WITHHOLDING USES.
--
-- Zoho names its TDS master by the NATURE of the payment — "Professional Fees
-- 10%", "Payment of contractors HUF/Indiv 1%", "Commission or Brokerage 5%" —
-- and never by section. The desk names the SECTION: both CMG & COMPANY and
-- FIRST FLY EXPRESS carry "393(2) Sl.17", at 10% and 1%, for professional fees
-- and courier work respectively.
--
-- Neither can be derived from the other, and guessing across them is what
-- attached "Dividend" to CMG's bill on 3 September 2026. So the choice is made
-- once, by a person, from Zoho's real list, and kept on the rule.
alter table provider_bill_rules
  add column if not exists tds_tax_id   text,
  add column if not exists tds_tax_name text;

comment on column provider_bill_rules.tds_tax_id is
  'Zoho tax_id of the TDS rate to attach. Chosen from Zoho''s own master; never guessed from the section.';
comment on column provider_bill_rules.tds_tax_name is
  'The name as Zoho spells it, kept so the screen can show what was chosen without a lookup.';
