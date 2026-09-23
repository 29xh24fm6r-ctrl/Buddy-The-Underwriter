-- Repair only the known synthetic 1040 fixture, never a real borrower's identity.
-- Preserve every document/fact and an audit snapshot; unexpected state aborts.
DO $$
DECLARE
  duplicate_owner public.ownership_entities;
  canonical_id uuid;
  owner_count integer;
  document_ids uuid[];
  fact_ids uuid[];
  reference_column record;
  has_reference boolean;
BEGIN
  FOR duplicate_owner IN
    SELECT o.* FROM public.ownership_entities o
    JOIN public.deals d ON d.id = o.deal_id
    WHERE d.is_test IS TRUE
      AND o.display_name = E'QA TEST OWNER\nTax year'
      AND o.entity_type = 'individual'
      AND o.ownership_pct IS NULL AND o.meta_json = '{}'::jsonb
    FOR UPDATE OF o, d
  LOOP
    SELECT count(*) INTO owner_count FROM public.ownership_entities
      WHERE deal_id = duplicate_owner.deal_id;
    SELECT id INTO canonical_id FROM public.ownership_entities
      WHERE deal_id = duplicate_owner.deal_id AND display_name = 'QA Test Owner'
        AND entity_type = 'individual' AND ownership_pct = 100
        AND meta_json->>'source' = 'borrower_portal'
      FOR UPDATE;
    IF owner_count <> 2 OR canonical_id IS NULL THEN
      RAISE EXCEPTION 'Synthetic owner repair requires one canonical owner and one duplicate';
    END IF;

    SELECT array_agg(id) INTO document_ids FROM public.deal_documents
      WHERE assigned_owner_id = duplicate_owner.id;
    IF coalesce(cardinality(document_ids), 0) <> 3 OR
      (SELECT count(DISTINCT original_filename) FROM public.deal_documents
        WHERE id = ANY(document_ids) AND deal_id = duplicate_owner.deal_id
          AND original_filename IN ('QA-SYNTHETIC-Form-1040-2023.pdf',
            'QA-SYNTHETIC-Form-1040-2024.pdf', 'QA-SYNTHETIC-Form-1040-2025.pdf')) <> 3 THEN
      RAISE EXCEPTION 'Synthetic owner repair requires the three known QA tax returns';
    END IF;

    SELECT array_agg(id) INTO fact_ids FROM public.deal_financial_facts
      WHERE owner_entity_id = duplicate_owner.id;
    IF coalesce(cardinality(fact_ids), 0) <> 24 OR
      (SELECT count(*) FROM public.deal_financial_facts WHERE id = ANY(fact_ids)
        AND deal_id = duplicate_owner.deal_id AND owner_type = 'PERSONAL'
        AND source_document_id = ANY(document_ids)) <> 24 THEN
      RAISE EXCEPTION 'Synthetic owner repair requires the 24 known personal tax facts';
    END IF;

    UPDATE public.deal_documents SET assigned_owner_id = canonical_id
      WHERE id = ANY(document_ids) AND assigned_owner_id = duplicate_owner.id;
    UPDATE public.deal_financial_facts SET owner_entity_id = canonical_id
      WHERE id = ANY(fact_ids) AND owner_entity_id = duplicate_owner.id;

    -- Refuse to cascade-delete verification/signing data or orphan any known
    -- owner reference, including legacy tables without foreign keys.
    FOR reference_column IN
      SELECT DISTINCT n.nspname, c.relname, a.attname
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype
        AND (a.attname IN ('assigned_owner_id', 'owner_entity_id',
          'ownership_entity_id', 'signer_ownership_entity_id') OR EXISTS (
            SELECT 1 FROM pg_constraint fk WHERE fk.contype = 'f'
              AND fk.confrelid = 'public.ownership_entities'::regclass
              AND fk.conrelid = c.oid AND a.attnum = ANY(fk.conkey)))
    LOOP
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
        reference_column.nspname, reference_column.relname, reference_column.attname)
        INTO has_reference USING duplicate_owner.id;
      IF has_reference THEN
        RAISE EXCEPTION 'Synthetic owner still referenced by %.%',
          reference_column.relname, reference_column.attname;
      END IF;
    END LOOP;

    INSERT INTO public.deal_events(deal_id, kind, payload)
    VALUES (duplicate_owner.deal_id, 'ownership.synthetic_duplicate_reconciled',
      jsonb_build_object('source', '20260923142259_reconcile_synthetic_qa_tax_owner',
        'removed_owner', to_jsonb(duplicate_owner), 'canonical_owner_id', canonical_id,
        'document_ids', to_jsonb(document_ids), 'financial_fact_ids', to_jsonb(fact_ids)));
    DELETE FROM public.ownership_entities WHERE id = duplicate_owner.id;
  END LOOP;
END;
$$;
