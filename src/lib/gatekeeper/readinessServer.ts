/**
 * Gatekeeper Readiness — Server-Side Integration
 *
 * Queries deal_documents for gatekeeper-classified docs, loads the intake
 * scenario, and delegates to the pure readiness engine.
 *
 * This is the only file with DB access — readiness.ts and requirements.ts
 * are pure functions.
 */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  loadIntakeScenario,
  CONVENTIONAL_FALLBACK,
} from "@/lib/intake/slots/ensureDeterministicSlots";
import { deriveScenarioRequirements } from "./requirements";
import {
  computeGatekeeperReadiness,
  type GatekeeperReadinessResult,
  type GatekeeperDocRow,
} from "./readiness";

export type { GatekeeperReadinessResult } from "./readiness";

/**
 * Compute gatekeeper-derived document readiness for a deal.
 *
 * Steps:
 * 1. Load intake scenario (fallback to CONVENTIONAL_FALLBACK)
 * 2. Derive requirements from scenario
 * 3. Query ALL gatekeeper-classified docs (review + non-review)
 * 4. Delegate to pure matching engine
 */
export async function computeGatekeeperDocReadiness(
  dealId: string,
): Promise<GatekeeperReadinessResult> {
  const sb = supabaseAdmin();

  // 1. Load scenario
  const scenario = await loadIntakeScenario(dealId);
  const effectiveScenario = scenario ?? CONVENTIONAL_FALLBACK;

  // 2. Derive requirements
  const requirements = deriveScenarioRequirements({
    scenario: effectiveScenario,
  });

  // 3. Query all gatekeeper-classified docs (both review and non-review)
  const { data: rows } = await (sb as any)
    .from("deal_documents")
    .select(
      "gatekeeper_doc_type, gatekeeper_tax_year, gatekeeper_needs_review",
    )
    .eq("deal_id", dealId)
    .not("gatekeeper_classified_at", "is", null);

  const documents: GatekeeperDocRow[] = (rows ?? []).map((r: any) => ({
    gatekeeper_doc_type: r.gatekeeper_doc_type ?? "UNKNOWN",
    gatekeeper_tax_year: r.gatekeeper_tax_year ?? null,
    gatekeeper_needs_review: r.gatekeeper_needs_review === true,
  }));

  // 4. Delegate to pure engine
  return computeGatekeeperReadiness({ requirements, documents });
}
