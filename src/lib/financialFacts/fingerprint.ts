import { createHash } from "node:crypto";

// Evidence identity, value and selection state; exclude write timestamps so an
// idempotent re-extraction does not invalidate an otherwise identical snapshot.
const INPUT_KEYS = [
  "id", "fact_type", "fact_key", "fact_period_start", "fact_period_end",
  "fact_value_num", "fact_value_text", "source_document_id", "entity_id",
  "owner_entity_id", "owner_type", "source_canonical_type", "confidence", "resolution_status", "is_superseded",
] as const;

export function financialFactFingerprint(facts: readonly Record<string, unknown>[]): string {
  // The recompute route writes its stress output after computing the base
  // snapshot. That output is not an input dependency of its own computation.
  const inputs = facts.filter(fact => !(fact.fact_key === "DSCR_STRESSED_300BPS"
    && (fact.provenance as { source_ref?: string } | null)?.source_ref === "computed:stress:rate_up_300bps"));
  const rows = inputs.map(fact => JSON.stringify([
    ...INPUT_KEYS.map(key => fact[key] ?? null),
    ...["source_type", "source_ref", "extractor", "as_of_date"].map(key =>
      (fact.provenance as Record<string, unknown> | null)?.[key] ?? null),
  ])).sort();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
