-- SPEC S4 H-1 — add the two remaining conditional SBA_7A_BASE package
-- items (SBA_155, SBA_159) using the same required:false convention
-- 20251218000013_sba_package_builder.sql already established for SBA_912
-- (conditional items ship as required:false; the actual applicability
-- check happens in sbaFormDispatch.ts at generation time, not in
-- resolvePackage.ts's `applies()`, which only understands `product`).
-- SBA_1920 is deliberately absent (ARC-00 A-S4-1 — struck entirely).
BEGIN;

WITH pkg AS (
  SELECT id FROM public.sba_package_templates WHERE code = 'SBA_7A_BASE' LIMIT 1
)
INSERT INTO public.sba_package_items
  (package_template_id, template_code, title, sort_order, required, applies_when)
SELECT pkg.id, x.template_code, x.title, x.sort_order, x.required, x.applies_when
FROM pkg
CROSS JOIN (
  VALUES
    ('SBA_155', 'SBA Form 155 (Standby Creditor''s Agreement)', 50, false, '{"product":"7a"}'::jsonb),
    ('SBA_159', 'SBA Form 159 (Fee Disclosure and Compensation Agreement)', 60, false, '{"product":"7a"}'::jsonb)
) AS x(template_code, title, sort_order, required, applies_when)
ON CONFLICT ON CONSTRAINT sba_package_items_unique_pkg_template DO NOTHING;

COMMIT;
