-- IGNITE-BORROWER-LINKAGE backfill
-- For every deal with borrower_id IS NULL, create a placeholder borrower
-- row in the same bank and attach it. Subsequent autofill will enrich the
-- placeholder when documents are processed.
--
-- Idempotent: re-runs are no-ops because the WHERE filters out attached deals.
-- Safe: never overwrites an existing borrower_id (concurrent-attach guard).

DO $$
DECLARE
  orphan_deal RECORD;
  new_borrower_id UUID;
  total_backfilled INT := 0;
BEGIN
  FOR orphan_deal IN
    SELECT id, bank_id, name
    FROM deals
    WHERE borrower_id IS NULL
      AND bank_id IS NOT NULL
  LOOP
    INSERT INTO borrowers (bank_id, legal_name, entity_type)
    VALUES (orphan_deal.bank_id, 'Pending Autofill', 'Unknown')
    RETURNING id INTO new_borrower_id;

    UPDATE deals
    SET borrower_id = new_borrower_id,
        borrower_name = 'Pending Autofill'
    WHERE id = orphan_deal.id
      AND borrower_id IS NULL; -- guard against concurrent attach

    total_backfilled := total_backfilled + 1;
  END LOOP;

  RAISE NOTICE 'IGNITE-BORROWER-LINKAGE backfill complete: % deals backfilled', total_backfilled;
END $$;
