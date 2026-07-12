-- ARC-00 Phase 5 (NEW SPEC S7) — add closing forms (148/148L, 601, 722) to
-- both SBA_7A_BASE and SBA_504_BASE. 148/148L and 722 are effectively
-- always-applicable at closing (required:true at the package-item level;
-- sbaFormDispatch.ts's own applicability gate still decides per-deal
-- whether a given signer/condition is met, same as every other
-- conditional item in this arc — the `required` column here is
-- informational, not enforced). 601 is required:false (conditional on
-- construction > $10K in use of proceeds, evaluated by the dispatcher).
BEGIN;

WITH pkg AS (
  SELECT id, code FROM public.sba_package_templates WHERE code IN ('SBA_7A_BASE', 'SBA_504_BASE')
), forms AS (
  SELECT * FROM (VALUES
    ('SBA_148',  'SBA Form 148 (Unconditional Guarantee)', 70, true),
    ('SBA_148L', 'SBA Form 148L (Limited Guarantee)', 80, true),
    ('SBA_601',  'SBA Form 601 (Agreement of Compliance)', 90, false),
    ('SBA_722',  'SBA Form 722 (Equal Opportunity Poster — delivery acknowledgment)', 100, true)
  ) AS x(template_code, title, sort_order, required)
)
INSERT INTO public.sba_package_items
  (package_template_id, template_code, title, sort_order, required, applies_when)
SELECT pkg.id, forms.template_code, forms.title, forms.sort_order, forms.required,
  jsonb_build_object('product', CASE WHEN pkg.code = 'SBA_7A_BASE' THEN '7a' ELSE '504' END)
FROM pkg
CROSS JOIN forms
ON CONFLICT ON CONSTRAINT sba_package_items_unique_pkg_template DO NOTHING;

COMMIT;
