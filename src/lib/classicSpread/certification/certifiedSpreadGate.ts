/**
 * SPEC-CLASSIC-SPREAD-CERTIFICATION-INTEGRATION-GATE-1 (Phase 6) — IO wrapper.
 *
 * Loads certification-relevant facts and delegates to the PURE core (certifiedSpreadGateCore.ts).
 * Read-only; never throws. Does NOT import reconcileFinancialFacts; does NOT touch the canonical VM.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  computeCertificationDecisions,
  type GateFact,
  type CertificationGateResult,
} from "./certifiedSpreadGateCore";

export { applyCertificationToInput } from "./certifiedSpreadGateCore";
export type {
  ClassicSpreadCertificationAudit,
  CertificationDecisions,
  CertificationGateResult,
  GateFact,
} from "./certifiedSpreadGateCore";

/** Load certification-relevant facts and compute the gate result. Read-only; never throws. */
export async function runClassicSpreadCertification(
  dealId: string,
  bankId: string,
  ctx: { periods: string[]; gcfTaxYear: number | null },
): Promise<CertificationGateResult | null> {
  try {
    const sb = supabaseAdmin();
    const { data } = await (sb as any)
      .from("deal_financial_facts")
      .select(
        "id, fact_key, fact_value_num, fact_period_end, owner_type, owner_entity_id, source_document_id, source_canonical_type, fact_type, confidence, provenance, is_superseded, resolution_status",
      )
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .not("fact_value_num", "is", null);

    const facts: GateFact[] = ((data ?? []) as any[]).map((r) => ({
      id: r.id ?? null,
      fact_key: r.fact_key,
      fact_value_num: r.fact_value_num !== null ? Number(r.fact_value_num) : null,
      fact_period_end: r.fact_period_end ?? null,
      owner_type: r.owner_type,
      owner_entity_id: r.owner_entity_id ?? null,
      source_document_id: r.source_document_id ?? null,
      source_canonical_type: r.source_canonical_type ?? null,
      fact_type: r.fact_type ?? null,
      confidence: r.confidence !== null && r.confidence !== undefined ? Number(r.confidence) : null,
      extractor: r.provenance?.extractor ?? null,
      is_superseded: r.is_superseded ?? null,
      resolution_status: r.resolution_status ?? null,
    }));

    return computeCertificationDecisions(facts, ctx);
  } catch {
    return null;
  }
}
