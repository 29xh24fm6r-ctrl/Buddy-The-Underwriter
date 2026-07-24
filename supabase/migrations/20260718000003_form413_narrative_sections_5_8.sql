-- Closes the Form 413 Sections 5-8 gap flagged in
-- docs/sba-forms/TASK-B-ACROFORM-FIELD-VERIFICATION.md §9: the real PDF's
-- other-personal-property/unpaid-taxes/other-liabilities/life-insurance
-- sections are free-text narrative fields (confirmed against
-- docs/sba-forms/413-fields.json — each a single Row1 text field), already
-- mapped in form413/pdfFieldMap.ts, but nothing in
-- borrower_applicant_financials stored the narrative text itself
-- (income_other_description already existed for Section 4's income line;
-- these 4 are the same pattern for Sections 5-8).
BEGIN;

ALTER TABLE public.borrower_applicant_financials
  ADD COLUMN IF NOT EXISTS other_personal_property_description text,
  ADD COLUMN IF NOT EXISTS unpaid_taxes_description text,
  ADD COLUMN IF NOT EXISTS other_liabilities_description text,
  ADD COLUMN IF NOT EXISTS life_insurance_description text;

COMMIT;
