-- THE TWENTY FIGURES THE 1040 CANNOT GET FROM THE BOOKS.
--
-- "i want my us 1040 page" — 5 September 2026. The income side comes from Zoho
-- and computes itself; everything here is a number that exists on a document
-- nobody's accounting system holds — a 1099, Form 5498, the account transcript,
-- a collector's rate on a deed — or a figure Congress sets.
--
-- Kept per year, because every one of them changes: the bracket table, the
-- standard deduction, the social security wage base. Last year's return must
-- still show last year's law.
create table if not exists us1040_inputs (
  year        integer not null,
  key         text    not null,
  value       numeric not null default 0,
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (year, key)
);

comment on table us1040_inputs is
  'Per-year inputs to the US 1040 worksheet. The income side is read from Zoho; these are the figures that come off a document or from statute.';

alter table us1040_inputs enable row level security;
revoke all on us1040_inputs from anon, authenticated;
