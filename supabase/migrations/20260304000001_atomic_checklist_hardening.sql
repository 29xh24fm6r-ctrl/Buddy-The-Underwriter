-- ═══════════════════════════════════════════════════════════════════════════════
-- Atomic Checklist Hardening — Dual-Layer Structural Guarantees
--
-- Phase F: atomic_retype_document RPC (single-transaction canonical_type change)
-- Phase H: reconcile_checklist_for_deal_sql called inside finalize RPC
-- Phase J: NOT NULL constraint for finalized docs
-- Phase K: Canonical type → checklist_key mapping constraint
-- Phase L: Unique checklist pointer integrity index
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Phase F: resolve_checklist_key_sql ─────────────────────────────────────
-- SQL mirror of resolveChecklistKey() in src/lib/docTyping/resolveChecklistKey.ts
-- MUST be kept in sync. Pure function — deterministic mapping.

CREATE OR REPLACE FUNCTION public.resolve_checklist_key_sql(
  p_canonical_type text,
  p_doc_year int DEFAULT NULL
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_canonical_type
    WHEN 'PERSONAL_FINANCIAL_STATEMENT' THEN 'PFS_CURRENT'
    WHEN 'PERSONAL_TAX_RETURN' THEN
      CASE WHEN p_doc_year IS NOT NULL THEN 'IRS_PERSONAL_' || p_doc_year::text ELSE NULL END
    WHEN 'BUSINESS_TAX_RETURN' THEN
      CASE WHEN p_doc_year IS NOT NULL THEN 'IRS_BUSINESS_' || p_doc_year::text ELSE NULL END
    WHEN 'BALANCE_SHEET' THEN 'FIN_STMT_BS_YTD'
    WHEN 'INCOME_STATEMENT' THEN 'FIN_STMT_PL_YTD'
    WHEN 'RENT_ROLL' THEN 'RENT_ROLL'
    WHEN 'BANK_STATEMENT' THEN 'BANK_STMT_3M'
    ELSE NULL
  END;
$$;

-- ── Phase F: reconcile_checklist_for_deal_sql ──────────────────────────────
-- Lightweight SQL reconciler: re-derives checklist_key for ALL docs in a deal,
-- then ensures checklist items reflect the current state.
-- The full TS reconciler (reconcileChecklistForDeal) does the heavy lifting
-- (year satisfaction, conflict resolution, signals). This SQL version handles
-- the critical invariant: every finalized doc with a canonical_type that maps
-- to a checklist slot MUST have its checklist_key set.

CREATE OR REPLACE FUNCTION public.reconcile_checklist_for_deal_sql(p_deal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_derived_key text;
BEGIN
  -- Re-derive checklist_key for every document in the deal
  FOR r IN
    SELECT id, canonical_type, doc_year, checklist_key
    FROM deal_documents
    WHERE deal_id = p_deal_id
      AND is_active = true
  LOOP
    v_derived_key := resolve_checklist_key_sql(r.canonical_type, r.doc_year);

    -- Only update if the derived key differs from the stored key
    IF v_derived_key IS DISTINCT FROM r.checklist_key THEN
      UPDATE deal_documents
      SET checklist_key = v_derived_key
      WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;

-- ── Phase F: atomic_retype_document ────────────────────────────────────────
-- Single-transaction RPC that atomically:
-- 1. Locks the document row
-- 2. Updates canonical_type + document_type
-- 3. Derives and sets checklist_key
-- 4. Reconciles the entire deal's checklist state
--
-- No partial updates. No UI-supplied checklist_key accepted.

CREATE OR REPLACE FUNCTION public.atomic_retype_document(
  p_document_id uuid,
  p_new_canonical_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id uuid;
  v_doc_year int;
  v_new_checklist_key text;
BEGIN
  -- Lock the document row for the duration of this transaction
  SELECT deal_id, doc_year
  INTO v_deal_id, v_doc_year
  FROM deal_documents
  WHERE id = p_document_id
  FOR UPDATE;

  IF v_deal_id IS NULL THEN
    RAISE EXCEPTION 'Document not found: %', p_document_id;
  END IF;

  -- Update canonical_type + document_type (always in sync)
  UPDATE deal_documents
  SET
    canonical_type = p_new_canonical_type,
    document_type = p_new_canonical_type
  WHERE id = p_document_id;

  -- Derive checklist_key deterministically
  v_new_checklist_key := resolve_checklist_key_sql(
    p_new_canonical_type,
    v_doc_year
  );

  -- Update checklist_key (derived, never from client)
  UPDATE deal_documents
  SET checklist_key = v_new_checklist_key
  WHERE id = p_document_id;

  -- Reconcile the entire deal's checklist state
  PERFORM reconcile_checklist_for_deal_sql(v_deal_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_checklist_key_sql TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_checklist_key_sql TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_checklist_for_deal_sql TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_checklist_for_deal_sql TO service_role;
GRANT EXECUTE ON FUNCTION public.atomic_retype_document TO authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_retype_document TO service_role;

-- ── Phase H: Patch finalize_intake_and_enqueue_processing ──────────────────
-- Add reconcile_checklist_for_deal_sql call immediately after stamping docs.
-- Processing must never start with stale checklist state.

CREATE OR REPLACE FUNCTION public.finalize_intake_and_enqueue_processing(
  p_deal_id uuid,
  p_run_id text,
  p_bank_id uuid DEFAULT NULL,
  p_snapshot_hash text DEFAULT NULL,
  p_snapshot_version text DEFAULT 'snapshot_v1',
  p_confirmed_by text DEFAULT NULL,
  p_docs_locked int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_stamped_ids uuid[];
  v_stamped_count int;
  v_result jsonb;
BEGIN
  -- ── Step 1: Stamp quality_status + finalized_at on ALL active docs ────
  -- Idempotent: only touches docs where finalized_at IS NULL.
  WITH stamped AS (
    UPDATE deal_documents
    SET
      quality_status = 'PASSED',
      finalized_at = v_now
    WHERE deal_id = p_deal_id
      AND is_active = true
      AND finalized_at IS NULL
    RETURNING id
  )
  SELECT array_agg(id), count(*)
  INTO v_stamped_ids, v_stamped_count
  FROM stamped;

  -- Normalize null array to empty
  v_stamped_ids := COALESCE(v_stamped_ids, ARRAY[]::uuid[]);
  v_stamped_count := COALESCE(v_stamped_count, 0);

  -- ── Step 1b: Reconcile checklist state (Phase H) ─────────────────────
  -- Ensure every doc has correct checklist_key before processing begins.
  PERFORM reconcile_checklist_for_deal_sql(p_deal_id);

  -- ── Step 2: Emit intake.documents_finalized event ─────────────────────
  IF v_stamped_count > 0 THEN
    INSERT INTO deal_events (deal_id, kind, payload)
    VALUES (
      p_deal_id,
      'intake.documents_finalized',
      jsonb_build_object(
        'scope', 'intake',
        'action', 'documents_finalized',
        'meta', jsonb_build_object(
          'doc_ids', to_jsonb(v_stamped_ids),
          'count', v_stamped_count,
          'finalized_at', v_now,
          'quality_status', 'PASSED',
          'confirmed_by', p_confirmed_by
        )
      )
    );
  END IF;

  -- ── Step 3: Insert outbox row (durable processing trigger) ────────────
  INSERT INTO buddy_outbox_events (kind, deal_id, bank_id, payload, source)
  VALUES (
    'intake.process',
    p_deal_id,
    p_bank_id,
    jsonb_build_object(
      'deal_id', p_deal_id,
      'run_id', p_run_id,
      'reason', 'confirm_all',
      'snapshot_hash', p_snapshot_hash,
      'docs_locked', p_docs_locked
    ),
    'buddy'
  );

  -- ── Step 4: Transition deal + stamp run markers ───────────────────────
  UPDATE deals
  SET
    intake_phase = 'CONFIRMED_READY_FOR_PROCESSING',
    intake_snapshot_hash = p_snapshot_hash,
    intake_snapshot_version = p_snapshot_version,
    intake_processing_queued_at = v_now,
    intake_processing_started_at = NULL,
    intake_processing_run_id = p_run_id,
    intake_processing_last_heartbeat_at = NULL,
    intake_processing_error = NULL
  WHERE id = p_deal_id;

  -- ── Return summary ────────────────────────────────────────────────────
  v_result := jsonb_build_object(
    'ok', true,
    'deal_id', p_deal_id,
    'run_id', p_run_id,
    'stamped_doc_count', v_stamped_count,
    'stamped_doc_ids', to_jsonb(v_stamped_ids),
    'finalized_at', v_now
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_intake_and_enqueue_processing TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_intake_and_enqueue_processing TO service_role;

-- ── Backfill: repair existing data before adding constraints ───────────────
-- Fix finalized docs with resolvable canonical_type but missing checklist_key.
UPDATE deal_documents
SET checklist_key = resolve_checklist_key_sql(canonical_type, doc_year)
WHERE finalized_at IS NOT NULL
  AND canonical_type IS NOT NULL
  AND resolve_checklist_key_sql(canonical_type, doc_year) IS NOT NULL
  AND checklist_key IS NULL;

-- Fix non-finalized docs with required canonical_type but missing checklist_key.
UPDATE deal_documents
SET checklist_key = resolve_checklist_key_sql(canonical_type, doc_year)
WHERE requires_checklist_key(canonical_type)
  AND checklist_key IS NULL
  AND resolve_checklist_key_sql(canonical_type, doc_year) IS NOT NULL;

-- ── Phase J: NOT NULL constraint for finalized docs ────────────────────────
-- Any finalized document MUST have a checklist_key.
-- Prevents "PFS uploaded but missing" by making the broken state impossible.

ALTER TABLE deal_documents
ADD CONSTRAINT finalized_docs_must_have_checklist_key
CHECK (
  finalized_at IS NULL
  OR canonical_type IS NULL
  OR resolve_checklist_key_sql(canonical_type, doc_year) IS NULL
  OR checklist_key IS NOT NULL
);

-- ── Phase K: Canonical type → checklist mapping constraint ─────────────────
-- If a canonical_type is one that MUST map to a checklist_key, enforce it.

CREATE OR REPLACE FUNCTION public.requires_checklist_key(p_canonical_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_canonical_type IN (
    'PERSONAL_FINANCIAL_STATEMENT',
    'BUSINESS_TAX_RETURN',
    'PERSONAL_TAX_RETURN',
    'BALANCE_SHEET',
    'INCOME_STATEMENT'
  );
$$;

-- For types that always resolve to a key (no year dependency), enforce directly.
-- Tax returns depend on doc_year so are covered by Phase J constraint above.
ALTER TABLE deal_documents
ADD CONSTRAINT required_types_must_have_checklist_key
CHECK (
  NOT requires_checklist_key(canonical_type)
  OR checklist_key IS NOT NULL
);

-- ── Phase L: Unique checklist pointer integrity ────────────────────────────
-- Only one winner per checklist_key per deal.
-- Prevents duplicate checklist satisfaction pointers.

CREATE UNIQUE INDEX IF NOT EXISTS unique_checklist_pointer
ON deal_checklist_items(deal_id, checklist_key)
WHERE received_document_id IS NOT NULL;
