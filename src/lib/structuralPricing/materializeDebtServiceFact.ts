/** @deprecated SPEC-BUDDY-FINENGINE-QUARANTINE-AND-CONNECT-1 — legacy ACTIVE-PRODUCER, quarantined.
 *  Materializes ANNUAL_DEBT_SERVICE (deal_structural_pricing:). Do NOT add new importers
 *  (enforced by guard:finengine → guard-finengine-legacy-imports). Migrating to
 *  src/lib/finengine/metrics + debtEngine. Tracked in docs/finengine/LEGACY_IMPORT_INVENTORY.md.
 *  No behavior change. */
import "server-only";

import { upsertDealFinancialFact, SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import type { StructuralPricingResult } from "./computeStructuralPricing";

/**
 * Materialize ANNUAL_DEBT_SERVICE as a canonical financial fact
 * from structural pricing data.
 *
 * Uses confidence 0.7 (lower than spread-derived 0.85) so spread values
 * take precedence when available via the upsert conflict resolution.
 */
export async function materializeDebtServiceFact(args: {
  dealId: string;
  bankId: string;
  structuralPricing: StructuralPricingResult;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { dealId, bankId, structuralPricing } = args;

  if (structuralPricing.annual_debt_service_est == null) {
    return { ok: false, error: "No annual_debt_service_est to materialize" };
  }

  return upsertDealFinancialFact({
    dealId,
    bankId,
    sourceDocumentId: SENTINEL_UUID, // No document — computed from loan terms
    factType: "SNAPSHOT_METRIC",
    factKey: "ANNUAL_DEBT_SERVICE",
    factValueNum: structuralPricing.annual_debt_service_est,
    confidence: 0.7,
    provenance: {
      source_type: "STRUCTURAL",
      source_ref: `deal_structural_pricing:${structuralPricing.id}`,
      as_of_date: new Date().toISOString().slice(0, 10),
    },
    ownerType: "DEAL",
    ownerEntityId: SENTINEL_UUID,
    // SPEC-CURRENT-STAGE-AUDIT-FIX-2: deal-level derived ADS scalar (no statement period) —
    // opt into the sentinel period so writeFact's MIN_VALID_PERIOD_DATE guard doesn't silently
    // reject it. Confidence 0.7 keeps it a fallback behind the spread-derived ADS.
    allowSentinelPeriod: true,
  });
}
