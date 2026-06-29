/**
 * SPEC-FINENGINE god-tier improvement D / SPEC-FINENGINE-MEMO-CUTOVER-1 Phase 2 —
 * memo assembly + cutover gate, now ENGINE-BACKED end to end.
 *
 * Turns a deal's certified facts (+ a bundle of deal primitives) into a
 * finengine-backed credit memo: compute the spread, validate it (selection-layer
 * guard + anchors from Phase 1), RUN the engine modules (risk rating, covenants,
 * stress, global cash flow, collateral) to populate every memo section, and
 * attach the cutover gate.
 *
 * The engine OWNS the financial sections (it computes them from primitives — the
 * caller no longer hand-supplies a risk grade or covenant package); the caller's
 * non-financial inputs (borrower, request, sources/uses) pass through untouched.
 * Pure, read-only, G4-clean (assembles certified objects; computes no number the
 * engine modules didn't). Flipping the live route to call this is Phase 4.
 */

import { computeDealSpread, type DealSpread } from "@/lib/finengine/spread/dealSpread";
import type { IndustryProfile } from "@/lib/industryIntelligence/types";
import { validateSpread, type SpreadValidation, type IntendedDivergence, type HardAnchor } from "@/lib/finengine/spread/validateSpread";
import { spreadToMemoContribution } from "@/lib/finengine/spread/spreadMemo";
import { buildCreditMemo, type MemoInputs, type MemoSection } from "@/lib/finengine/memo/buildCreditMemo";
import type { CertifiedFactRow, EntityScope } from "@/lib/finengine/shadow/dealInputAdapter";
import type { PolicyContext } from "@/lib/finengine/contracts";
import { rateRisk, type ObligorSignals, type FacilitySignals } from "@/lib/finengine/riskRating";
import { recommendCovenants, type CovenantRecommendationInputs } from "@/lib/finengine/covenants";
import { runStressBattery, type StressInputs } from "@/lib/finengine/stress/stressEngine";
import type { GlobalCashFlowResult } from "@/lib/finengine/methods/global";

export type CutoverGate = {
  allowed: boolean;
  blocked: boolean;
  unexpected: number;
  reason: string;
};

/** The cutover gate: a memo may not finalize while the spread diverges from the independent golden. */
export function memoGate(validation: SpreadValidation): CutoverGate {
  const blocked = validation.cutoverBlocked;
  return {
    allowed: !blocked,
    blocked,
    unexpected: validation.unexpected,
    reason: blocked
      ? `${validation.unexpected} UNEXPECTED divergence(s) vs the independent golden — analyst review or a registered exception is required before this memo can finalize.`
      : "Spread agrees with the independent golden — cleared for finalization.",
  };
}

/** Hard enforcement for a submission path: throws when the spread is cutover-blocked. */
export function assertCutoverClean(validation: SpreadValidation): void {
  if (validation.cutoverBlocked) {
    throw new Error(`[finengine] memo blocked: ${memoGate(validation).reason}`);
  }
}

/**
 * Submission-time enforcement (SPEC-FINENGINE-MEMO-CUTOVER-1 Phase 3). The memo
 * finalize/submit path calls this. It binds ONLY where the engine is live for the
 * tenant (`cutoverEnabled`) — a tenant on the legacy renderer is never blocked by
 * the engine gate. When the engine is live and the spread is cutover-blocked,
 * finalization throws with the analyst-facing reason (override = register the
 * divergence as INTENDED, or resolve the source data). Returns the gate otherwise.
 */
export function enforceMemoSubmission(validation: SpreadValidation, opts: { cutoverEnabled: boolean }): CutoverGate {
  const gate = memoGate(validation);
  if (opts.cutoverEnabled && gate.blocked) {
    throw new Error(`[finengine] memo submission blocked: ${gate.reason}`);
  }
  return gate;
}

/**
 * Resolve the borrower label (NG4 / G5): `display_name` is primary, with a
 * documented fallback for the deals whose `display_name` is null. Never a blank.
 */
export function resolveBorrowerLabel(src: { display_name?: string | null; borrower_name?: string | null; name?: string | null }): string {
  return (src.display_name?.trim() || src.borrower_name?.trim() || src.name?.trim() || "Borrower");
}

/** Deal primitives the engine modules consume to compute the memo's financial sections. */
export type MemoSignals = {
  productId?: string;
  ctx?: PolicyContext;
  /** Obligor signals for the risk rating; currentRatio is enriched from the spread when omitted. */
  riskObligor?: ObligorSignals;
  riskFacility?: FacilitySignals;
  /** Covenant inputs (underwritten DSCR/leverage default from riskObligor when omitted). */
  covenants?: CovenantRecommendationInputs;
  /** Stress battery inputs. */
  stress?: StressInputs;
  /** Pre-computed global cash flow (built from the entity graph by methods/global). */
  globalCashFlow?: GlobalCashFlowResult;
  collateral?: { discountedValue: number; loanExposure: number };
  guarantors?: Array<{ displayName: string; ownershipPct?: number; isGuarantor?: boolean }>;
};

export type FinengineMemoPackage = {
  spread: DealSpread;
  validation: SpreadValidation;
  gate: CutoverGate;
  memo: { sections: MemoSection[]; marketplaceRedacted: boolean };
  /** The engine-computed financial sections merged into the memo inputs. */
  engineInputs: Partial<MemoInputs>;
};

/** Latest real-period value of a metric in the spread (for enrichment). */
function latestMetric(spread: DealSpread, scope: EntityScope, metric: string): number | null {
  const cells = spread.cells
    .filter((c) => c.scope === scope && c.metric === metric && /^\d{4}-\d{2}-\d{2}$/.test(c.period))
    .sort((a, b) => (a.period < b.period ? -1 : 1));
  return cells.length ? cells[cells.length - 1].value : null;
}

/** Run the engine modules over the signals to produce the memo's financial sections. */
function engineSections(spread: DealSpread, scope: EntityScope, signals?: MemoSignals): Partial<MemoInputs> {
  const out: Partial<MemoInputs> = {};
  if (!signals) return out;
  const ctx = signals.ctx;

  // Risk rating — enrich the obligor's current ratio from the spread when omitted.
  if (signals.riskObligor && signals.riskFacility) {
    const obligor: ObligorSignals = {
      ...signals.riskObligor,
      currentRatio: signals.riskObligor.currentRatio ?? latestMetric(spread, scope, "CURRENT_RATIO"),
    };
    out.riskRating = rateRisk(obligor, signals.riskFacility, ctx);
  }

  // Covenant package — underwritten DSCR/leverage default from the obligor signals.
  if (signals.covenants || signals.riskObligor) {
    const cov = recommendCovenants({
      productId: signals.productId,
      underwrittenDscr: signals.covenants?.underwrittenDscr ?? signals.riskObligor?.dscr ?? null,
      underwrittenLeverage: signals.covenants?.underwrittenLeverage ?? signals.riskObligor?.leverage ?? null,
      minLiquidity: signals.covenants?.minLiquidity ?? null,
      ctx,
    });
    if (cov.length) out.covenants = cov.map((c) => ({ name: c.name, threshold: `${c.direction === "floor" ? "≥" : "≤"} ${c.threshold}`, note: c.note }));
  }

  // Stress battery.
  if (signals.stress) {
    const battery = runStressBattery(signals.stress, ctx);
    out.stress = battery.map((s) => ({ scenario: s.scenario, dscr: s.dscr, passes: s.passes }));
  }

  // Global cash flow — surfaced from the engine's graph consolidation.
  if (signals.globalCashFlow) {
    const g = signals.globalCashFlow;
    out.globalCashFlow = { globalDSCR: g.globalDSCR, globalCashBeforeDebt: g.globalCashBeforeDebt, globalDebtService: g.globalDebtService };
  }

  // Collateral coverage summary.
  if (signals.collateral && signals.collateral.loanExposure > 0) {
    const { discountedValue, loanExposure } = signals.collateral;
    const coverageRatio = discountedValue / loanExposure;
    out.collateral = { coverageRatio, shortfall: Math.max(0, loanExposure - discountedValue), guarantorSupportRequired: coverageRatio < 1 };
  }

  if (signals.guarantors?.length) out.ownershipGuarantors = signals.guarantors;

  return out;
}

/**
 * Assemble the finengine-backed memo for a deal. Pure: the live route loads the
 * certified rows, the non-financial MemoInputs, and the deal primitives, and
 * passes them here. The engine computes the financial sections; the caller's
 * non-financial inputs pass through. Read-only (NG1).
 */
export function buildFinengineMemoPackage(
  dealId: string,
  rows: CertifiedFactRow[],
  base: MemoInputs,
  opts?: { scope?: EntityScope; intended?: IntendedDivergence[]; hardAnchors?: HardAnchor[]; signals?: MemoSignals; industry?: IndustryProfile },
): FinengineMemoPackage {
  const scope = opts?.scope ?? "BUSINESS";
  const spread = computeDealSpread(dealId, rows, opts?.industry ? { industry: opts.industry } : undefined);
  const validation = validateSpread(spread, { scope, intended: opts?.intended, rawRows: rows, hardAnchors: opts?.hardAnchors });
  const gate = memoGate(validation);

  const { metrics, section } = spreadToMemoContribution(spread, {
    scope,
    validation: { unexpected: validation.unexpected, cutoverBlocked: validation.cutoverBlocked },
  });

  const engineInputs = engineSections(spread, scope, opts?.signals);

  // Engine OWNS the financial sections; caller's non-financial inputs pass through.
  // Engine metrics augment (never overwrite) any caller-supplied metrics.
  const merged: MemoInputs = {
    ...base,
    ...engineInputs,
    metrics: [...(base.metrics ?? []), ...metrics],
  };
  const built = buildCreditMemo(merged);

  return {
    spread,
    validation,
    gate,
    memo: { sections: [...built.sections, section], marketplaceRedacted: built.marketplaceRedacted },
    engineInputs,
  };
}
