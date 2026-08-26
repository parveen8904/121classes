-- WHAT THE INVOICE ITSELF SAYS, READ OFF THE PAPER.
--
-- 26 Aug 2026. Not one of 25 bills had a taxable value or a GST amount: the
-- columns and the boxes existed, and nobody ever typed into them. That single
-- gap produced three separate complaints -- the GST columns showed nothing,
-- the entry carried no GST treatment, and TDS came out on the gross because
-- the taxable value it should sit on was missing (FIRST FLY: 70.53 against a
-- correct 59.77).
--
-- His standing rule is that these figures are READ off the supplier invoice
-- and never derived. So this holds what was read from the PDF, kept SEPARATE
-- from the real columns: a reading is a proposal, and only he turns it into
-- the figures the entry uses. Nothing posts from this column.
alter table public.provider_bills
  add column if not exists tax_read jsonb;

comment on column public.provider_bills.tax_read is
  'Figures transcribed from the invoice PDF for confirmation: {taxable_value, cgst, sgst, igst, invoice_no, invoice_date, total, note, read_at}. Never used for posting until copied into the real columns by hand.';
