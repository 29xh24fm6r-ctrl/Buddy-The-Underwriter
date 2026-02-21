/**
 * Gatekeeper Readiness — Server-Side Integration
 *
 * Queries deal_documents for classified/confirmed docs, resolves effective
 * classification via the system-wide truth resolver, and delegates to
 * the pure readiness engine.
 *
 * This is the only file with DB access — readiness.ts, requirements.ts,
 * and resolveEffectiveClassification.ts are pure functions.
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
import { resolveEffectiveClassification } from "./resolveEffectiveClassification";

export type { GatekeeperReadinessResult } from "./readiness";

// ---------------------------------------------------------------------------
// Canonical → Gatekeeper vocabulary normalization
// ---------------------------------------------------------------------------

/**
 * Readiness Vocabulary Normalization
 *
 * The COALESCE truth resolver (resolveEffectiveClassification) returns
 * canonical types — the institutional truth. The pure readiness engine
 * operates on readiness vocabulary (FINANCIAL_STATEMENT, BUSINESS_TAX_RETURN,
 * PERSONAL_TAX_RETURN, PERSONAL_FINANCIAL_STATEMENT).
 *
 * This adapter translates canonical sub-types into readiness vocabulary
 * at the server boundary, so the pure engine receives only types it
 * understands. This is NOT downgrading canonical truth — it's a vocabulary
 * translation for a specific consumer.
 *
 * After this normalization, the pure engine uses types directly with no
 * further re-mapping.
 */
function toReadinessDocType(effectiveDocType: string): string {
  switch (effectiveDocType) {
    // Financial statement sub-types → readiness umbrella
    case "INCOME_STATEMENT":
    case "BALANCE_SHEET":
    case "T12":
      return "FINANCIAL_STATEMENT";
    // PFS aliases
    case "PFS":
      return "PERSONAL_FINANCIAL_STATEMENT";
    // Business tax return aliases (from spine classification)
    case "IRS_BUSINESS":
      return "BUSINESS_TAX_RETURN";
    // Personal tax return alias (spine classification)
    case "IRS_PERSONAL":
      return "PERSONAL_TAX_RETURN";
    // Supporting income docs — do NOT satisfy PTR requirements
    case "W2":
    case "FORM_1099":
    case "K1":
      return "OTHER";
    default:
      return effectiveDocType;
  }
}

/**
 * Compute document readiness for a deal.
 *
 * Steps:
 * 1. Load intake scenario (fallback to CONVENTIONAL_FALLBACK)
 * 2. Derive requirements from scenario
 * 3. Query ALL classified OR confirmed docs
 * 4. Resolve effective classification (confirmed truth > gatekeeper > AI)
 * 5. Delegate to pure matching engine
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

  // 3. Query all classified OR confirmed docs
  //    Confirmed docs are always visible to readiness, even if gatekeeper never ran.
  const { data: rows } = await (sb as any)
    .from("deal_documents")
    .select(
      `canonical_type, document_type, gatekeeper_doc_type, ai_doc_type,
       doc_year, gatekeeper_tax_year, ai_tax_year,
       gatekeeper_needs_review, gatekeeper_review_reason_code,
       intake_confirmed_at`,
    )
    .eq("deal_id", dealId)
    .or("gatekeeper_classified_at.not.is.null,intake_confirmed_at.not.is.null");

  // 4. Resolve effective classification per doc
  const documents: GatekeeperDocRow[] = (rows ?? []).map((r: any) => {
    const resolved = resolveEffectiveClassification({
      canonical_type: r.canonical_type,
      document_type: r.document_type,
      gatekeeper_doc_type: r.gatekeeper_doc_type,
      ai_doc_type: r.ai_doc_type,
      doc_year: r.doc_year,
      gatekeeper_tax_year: r.gatekeeper_tax_year,
      ai_tax_year: r.ai_tax_year,
      intake_confirmed_at: r.intake_confirmed_at,
    });

    // Human-confirmed docs are never "needs review" — the human already reviewed
    const needsReview = resolved.isConfirmed
      ? false
      : r.gatekeeper_needs_review === true;

    return {
      gatekeeper_doc_type: toReadinessDocType(resolved.effectiveDocType),
      gatekeeper_tax_year: resolved.effectiveTaxYear,
      gatekeeper_needs_review: needsReview,
      gatekeeper_review_reason_code: needsReview
        ? (r.gatekeeper_review_reason_code ?? null)
        : null,
    };
  });

  // 5. Delegate to pure engine
  return computeGatekeeperReadiness({ requirements, documents });
}

/**
 * Slot-based fallback readiness — used when gatekeeper is disabled or errored.
 * Prevents silent 0% by counting filled slots.
 */
export async function computeSlotFallbackReadiness(
  dealId: string,
): Promise<{ ready: boolean; readinessPct: number }> {
  const sb = supabaseAdmin();
  const { data: slots } = await (sb as any)
    .from("deal_document_slots")
    .select("id, status")
    .eq("deal_id", dealId);

  if (!slots || slots.length === 0) return { ready: false, readinessPct: 0 };

  const filled = slots.filter(
    (s: any) => s.status === "attached" || s.status === "validated" || s.status === "completed",
  ).length;

  const pct = Math.round((filled / slots.length) * 100);
  return { ready: pct === 100, readinessPct: pct };
}
