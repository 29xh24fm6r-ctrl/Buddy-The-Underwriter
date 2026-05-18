-- SPEC-T12-GATE-1: Add has_monthly_statements flag to deals
-- Controls T12 spread eligibility. False by default — must be confirmed by
-- banker or document classifier. Never set automatically.

ALTER TABLE public.deals
ADD COLUMN IF NOT EXISTS has_monthly_statements boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.deals.has_monthly_statements IS
'True only when the borrower has provided 12+ consecutive months of operating statements. Controls T12 spread eligibility (SPEC-T12-GATE-1). Never set automatically — must be confirmed by the banker or document classifier. False by default.';
