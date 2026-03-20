-- =====================================================================
-- POLICY MITIGANTS & EXCEPTION TEMPLATES
-- Warn + continue: show actionable mitigants when rules trigger
-- =====================================================================

-- Add mitigants + exception_template columns to bank_policy_rules
ALTER TABLE public.bank_policy_rules
ADD COLUMN IF NOT EXISTS mitigants JSONB NOT NULL DEFAULT '[]'::JSONB,
ADD COLUMN IF NOT EXISTS exception_template JSONB NOT NULL DEFAULT '{}'::JSONB;

-- Comments
COMMENT ON COLUMN public.bank_policy_rules.mitigants IS 'Array of {key, label, priority, note} - actionable steps when rule triggers';
COMMENT ON COLUMN public.bank_policy_rules.exception_template IS 'Object {title, justification_prompt, approvals[]} - prefilled exception stub';

-- =====================================================================
-- EXAMPLES:
-- =====================================================================
-- Mitigants format:
-- [
--   {"key":"add_collateral", "label":"Add additional collateral", "priority":1},
--   {"key":"strengthen_guarantor", "label":"Strengthen guarantor support", "priority":2},
--   {"key":"reduce_loan_amount", "label":"Reduce loan amount / increase equity", "priority":1}
-- ]
--
-- Exception template format:
-- {
--   "title": "LTV Exception Request",
--   "justification_prompt": "Explain why LTV exceeds policy maximum",
--   "approvals": ["Credit Admin", "CLO"]
-- }
-- =====================================================================
