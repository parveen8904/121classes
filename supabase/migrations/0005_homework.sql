-- =====================================================================
-- 121 Coaching — add 'homework' section type
-- Run in Supabase: SQL Editor → paste → Run. Safe to re-run.
-- (enum ADD VALUE is intentionally not wrapped in a transaction)
-- =====================================================================

alter type section_type add value if not exists 'homework';
