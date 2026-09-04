-- WHAT MONEY THIS STATEMENT IS IN.
--
-- Every figure on the statements desk was printed with a ₹ in front of it,
-- because rupees were the only currency the desk had ever been shown. His Citi
-- Costco card is a USD account in Zoho and its April statement came through as
-- "₹163.73" — the right number against the wrong sign, which is the kind of
-- wrongness that survives a review.
--
-- Defaulted from the Zoho account the statement belongs to, and editable,
-- because Zoho is the authority on the account but he is the authority on the
-- document.
alter table bank_statements
  add column if not exists currency text;

comment on column bank_statements.currency is
  'ISO code the statement''s figures are in (INR, USD…). Defaulted from the Zoho account at ingest; editable on the row.';

-- Everything filed before today was an Indian bank account, and every one of
-- them is in rupees. Said once, here, rather than left null for the display to
-- guess at every render.
update bank_statements set currency = 'INR' where currency is null;
