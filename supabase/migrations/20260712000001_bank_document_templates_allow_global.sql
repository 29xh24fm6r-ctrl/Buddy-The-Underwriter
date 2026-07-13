-- ARC-00 Phase 0.C: official SBA/IRS templates are bank-agnostic (one
-- official PDF per form, shared across every bank), but bank_document_templates
-- was built assuming every template is scoped to a bank_id. Relax bank_id to
-- nullable so a global template row can exist; the existing
-- (bank_id, template_key, version) unique constraint still protects per-bank
-- custom templates. Global-row idempotency is handled by the ingestion
-- script doing a manual select-then-upsert (Postgres treats NULL != NULL,
-- so a plain unique constraint can't enforce global uniqueness cleanly).

BEGIN;

ALTER TABLE public.bank_document_templates
  ALTER COLUMN bank_id DROP NOT NULL;

COMMENT ON COLUMN public.bank_document_templates.bank_id IS
  'NULL = global template shared across all banks (e.g. official SBA/IRS forms). Non-null = bank-specific custom template.';

COMMIT;
