-- ============================================================================
-- Slot Entity Binding Coverage — Layer 2.3
--
-- Measures structural binding between deal_document_slots and deal_entities.
-- Queries deal_document_slots directly (slot.created events do not exist).
-- Read-only, no mutation.
-- ============================================================================

CREATE OR REPLACE VIEW slot_entity_binding_coverage_v1 AS
SELECT
  required_doc_type                                                           AS doc_type,
  COUNT(*)                                                                    AS total_slots,
  COUNT(*) FILTER (WHERE required_entity_id IS NOT NULL)                      AS bound_slots,
  COUNT(*) FILTER (WHERE required_entity_id IS NULL)                          AS unbound_slots,
  ROUND(
    COUNT(*) FILTER (WHERE required_entity_id IS NOT NULL)::numeric /
    NULLIF(COUNT(*), 0)::numeric * 100,
    1
  )                                                                           AS binding_rate_pct
FROM deal_document_slots
WHERE required_doc_type IN (
  'PERSONAL_TAX_RETURN',
  'PERSONAL_FINANCIAL_STATEMENT',
  'BUSINESS_TAX_RETURN'
)
GROUP BY 1
ORDER BY unbound_slots DESC;
