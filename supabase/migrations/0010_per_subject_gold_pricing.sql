-- Per-subject Gold pricing.
-- Bronze stays free; Silver stays a flat global price (the active 'silver' plan's
-- web_price_inr). Gold price now varies per subject, matching the real catalog
-- where each course/batch has its own price.

alter table subjects
  add column if not exists gold_price_inr integer,
  add column if not exists validity_months integer not null default 12;

comment on column subjects.gold_price_inr is 'One-time Gold-tier price (INR) to unlock this subject for validity_months. NULL = sold only inside a combo / price not set.';
comment on column subjects.validity_months is 'Access months granted when a subject is purchased at Silver or Gold.';

-- Seed Gold prices from the imported single-subject Aldine batches (bundle-only
-- subjects intentionally left NULL for an admin to set).
update subjects set gold_price_inr = 9900, validity_months = 24 where slug = 'financial-reporting';
update subjects set gold_price_inr = 11500 where slug = 'int-adv-accounting';
update subjects set gold_price_inr = 7200  where slug = 'int-audit';
update subjects set gold_price_inr = 10500 where slug = 'int-cma';
update subjects set gold_price_inr = 10500 where slug = 'int-fm-sm';
update subjects set gold_price_inr = 11992 where slug = 'fin-dt';
