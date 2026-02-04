-- 20260204_add_satisfaction_json_to_deal_checklist_items
-- Ensures the satisfaction_json column exists on deal_checklist_items.
-- This column was originally defined in 20251231193000 but may not have
-- been applied to all environments (prod/preview).

ALTER TABLE public.deal_checklist_items
ADD COLUMN IF NOT EXISTS satisfaction_json jsonb;

COMMENT ON COLUMN public.deal_checklist_items.satisfaction_json IS
  'Metadata about how this checklist item was satisfied (e.g., consecutive years evaluation, evidence).';
