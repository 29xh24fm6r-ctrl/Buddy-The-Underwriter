-- Migration: Consolidate individual-year tax return checklist items into grouped _3Y items.
--
-- Existing deals may have IRS_PERSONAL_2024, IRS_PERSONAL_2023, IRS_PERSONAL_2022 (etc.)
-- as separate required checklist items. The new consecutive-years evaluator uses
-- IRS_PERSONAL_3Y / IRS_BUSINESS_3Y instead, so we:
--   1. Upsert grouped _3Y items for deals that have individual year items
--   2. Carry forward satisfied_years from individual items
--   3. Mark individual year items as optional (required=false)

BEGIN;

-- ============================================================
-- 1. Upsert IRS_PERSONAL_3Y for deals that have individual-year personal items
-- ============================================================
INSERT INTO deal_checklist_items (id, deal_id, checklist_key, title, required, status, satisfied_years)
SELECT
  gen_random_uuid(),
  sub.deal_id,
  'IRS_PERSONAL_3Y',
  'Personal Tax Returns (3 consecutive years)',
  true,
  CASE WHEN array_length(sub.all_years, 1) >= 3 THEN 'received' ELSE 'missing' END,
  sub.all_years
FROM (
  SELECT
    d.deal_id,
    array_agg(DISTINCT (regexp_match(d.checklist_key, '^IRS_PERSONAL_(\d{4})$'))[1]::int ORDER BY (regexp_match(d.checklist_key, '^IRS_PERSONAL_(\d{4})$'))[1]::int DESC) AS all_years
  FROM deal_checklist_items d
  WHERE d.checklist_key ~ '^IRS_PERSONAL_\d{4}$'
    AND d.status IN ('received', 'satisfied', 'waived')
  GROUP BY d.deal_id
) sub
WHERE NOT EXISTS (
  SELECT 1 FROM deal_checklist_items x
  WHERE x.deal_id = sub.deal_id AND x.checklist_key = 'IRS_PERSONAL_3Y'
)
ON CONFLICT (deal_id, checklist_key) DO NOTHING;

-- Also upsert for deals that have individual year items but none are satisfied yet
INSERT INTO deal_checklist_items (id, deal_id, checklist_key, title, required, status)
SELECT
  gen_random_uuid(),
  d.deal_id,
  'IRS_PERSONAL_3Y',
  'Personal Tax Returns (3 consecutive years)',
  true,
  'missing'
FROM deal_checklist_items d
WHERE d.checklist_key ~ '^IRS_PERSONAL_\d{4}$'
GROUP BY d.deal_id
HAVING NOT EXISTS (
  SELECT 1 FROM deal_checklist_items x
  WHERE x.deal_id = d.deal_id AND x.checklist_key = 'IRS_PERSONAL_3Y'
)
ON CONFLICT (deal_id, checklist_key) DO NOTHING;

-- ============================================================
-- 2. Upsert IRS_BUSINESS_3Y for deals that have individual-year business items
-- ============================================================
INSERT INTO deal_checklist_items (id, deal_id, checklist_key, title, required, status, satisfied_years)
SELECT
  gen_random_uuid(),
  sub.deal_id,
  'IRS_BUSINESS_3Y',
  'Business Tax Returns (3 consecutive years)',
  true,
  CASE WHEN array_length(sub.all_years, 1) >= 3 THEN 'received' ELSE 'missing' END,
  sub.all_years
FROM (
  SELECT
    d.deal_id,
    array_agg(DISTINCT (regexp_match(d.checklist_key, '^IRS_BUSINESS_(\d{4})$'))[1]::int ORDER BY (regexp_match(d.checklist_key, '^IRS_BUSINESS_(\d{4})$'))[1]::int DESC) AS all_years
  FROM deal_checklist_items d
  WHERE d.checklist_key ~ '^IRS_BUSINESS_\d{4}$'
    AND d.status IN ('received', 'satisfied', 'waived')
  GROUP BY d.deal_id
) sub
WHERE NOT EXISTS (
  SELECT 1 FROM deal_checklist_items x
  WHERE x.deal_id = sub.deal_id AND x.checklist_key = 'IRS_BUSINESS_3Y'
)
ON CONFLICT (deal_id, checklist_key) DO NOTHING;

-- Also upsert for deals that have individual year items but none are satisfied yet
INSERT INTO deal_checklist_items (id, deal_id, checklist_key, title, required, status)
SELECT
  gen_random_uuid(),
  d.deal_id,
  'IRS_BUSINESS_3Y',
  'Business Tax Returns (3 consecutive years)',
  true,
  'missing'
FROM deal_checklist_items d
WHERE d.checklist_key ~ '^IRS_BUSINESS_\d{4}$'
GROUP BY d.deal_id
HAVING NOT EXISTS (
  SELECT 1 FROM deal_checklist_items x
  WHERE x.deal_id = d.deal_id AND x.checklist_key = 'IRS_BUSINESS_3Y'
)
ON CONFLICT (deal_id, checklist_key) DO NOTHING;

-- ============================================================
-- 3. Mark individual year items as optional (preserves history)
-- ============================================================
UPDATE deal_checklist_items
SET required = false
WHERE checklist_key ~ '^IRS_(PERSONAL|BUSINESS)_\d{4}$'
  AND required = true;

COMMIT;
