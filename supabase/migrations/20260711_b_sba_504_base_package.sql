-- ARC-00 Phase 4 (NEW SPEC S6) — seed SBA_504_BASE package template + items.
BEGIN;

INSERT INTO public.sba_package_templates (code, name, description)
VALUES ('SBA_504_BASE', 'SBA 504 Base Package', 'Core SBA forms package for 504 submissions')
ON CONFLICT (code) DO NOTHING;

WITH pkg AS (
  SELECT id FROM public.sba_package_templates WHERE code = 'SBA_504_BASE' LIMIT 1
)
INSERT INTO public.sba_package_items
  (package_template_id, template_code, title, sort_order, required, applies_when)
SELECT pkg.id, x.template_code, x.title, x.sort_order, x.required, x.applies_when
FROM pkg
CROSS JOIN (
  VALUES
    ('SBA_1244', 'SBA Form 1244 (504 Loan Application)', 10, true,  '{"product":"504"}'::jsonb),
    ('SBA_413',  'SBA Form 413 (PFS)', 20, true, '{"product":"504"}'::jsonb),
    ('SBA_912',  'SBA Form 912', 30, false, '{"product":"504"}'::jsonb),
    ('IRS_4506C','IRS Form 4506-C', 40, true, '{"product":"504"}'::jsonb),
    ('SBA_159',  'SBA Form 159 (Fee Disclosure)', 50, true, '{"product":"504"}'::jsonb)
) AS x(template_code, title, sort_order, required, applies_when)
ON CONFLICT ON CONSTRAINT sba_package_items_unique_pkg_template DO NOTHING;

COMMIT;
