-- ─── Fix checklist titles: "3 years" → "3 consecutive years" ────────────────
-- Updates existing deal_checklist_items rows that have the old "(3 years)" label.
-- New deals already get the correct title from code definitions.

UPDATE public.deal_checklist_items
SET title = 'Business Tax Returns (3 consecutive years)'
WHERE checklist_key = 'IRS_BUSINESS_3Y'
  AND title ILIKE '%3 years%'
  AND title NOT ILIKE '%consecutive%';

UPDATE public.deal_checklist_items
SET title = 'Personal Tax Returns (3 consecutive years)'
WHERE checklist_key = 'IRS_PERSONAL_3Y'
  AND title ILIKE '%3 years%'
  AND title NOT ILIKE '%consecutive%';

-- Also update descriptions if they exist
UPDATE public.deal_checklist_items
SET description = REPLACE(description, '3 years of business tax returns', '3 consecutive years of business tax returns')
WHERE checklist_key = 'IRS_BUSINESS_3Y'
  AND description ILIKE '%3 years of business%'
  AND description NOT ILIKE '%consecutive%';

UPDATE public.deal_checklist_items
SET description = REPLACE(description, '3 years of personal tax returns', '3 consecutive years of personal tax returns')
WHERE checklist_key = 'IRS_PERSONAL_3Y'
  AND description ILIKE '%3 years of personal%'
  AND description NOT ILIKE '%consecutive%';
