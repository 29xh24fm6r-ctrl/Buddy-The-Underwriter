/**
 * DSCR Reconciliation — Pure Function
 *
 * Reconciles three DSCR measures (Entity, UCA, Global), explains the
 * primary variance driver, identifies which DSCR governs covenant testing,
 * and flags coverage concerns.
 *
 * No DB access. No side effects.
 */

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface DscrReconciliationInput {
  entityDscr: number | null;
  ucaDscr: number | null;
  globalDscr: number | null;
  entityCashFlowAvailable: number | null;
  ucaCashFromOperations: number | null;
  globalCashFlow: number | null;
  proposedAds: number | null;
  sponsorCount: number;
  entityCount: number;
}

export type VarianceDriver =
  | "WORKING_CAPITAL"
  | "SPONSOR_INCOME"
  | "OWNERSHIP_ADJUSTMENT"
  | "NONE"
  | "UNKNOWN";

export type CovenantDscr = "ENTITY" | "UCA" | "GLOBAL";

export interface DscrFlag {
  severity: "INFO" | "CAUTION" | "FLAG";
  message: string;
}

export interface DscrReconciliationResult {
  dscrTriangle: {
    entity: number | null;
    uca: number | null;
    global: number | null;
  };
  primaryVarianceDriver: VarianceDriver;
  varianceExplanation: string;
  covenantTestingDscr: CovenantDscr;
  covenantRationale: string;
  flags: DscrFlag[];
}

// ---------------------------------------------------------------------------
// Core reconciliation
// ---------------------------------------------------------------------------

export function reconcileDscr(
  input: DscrReconciliationInput,
): DscrReconciliationResult {
  const { entityDscr, ucaDscr, globalDscr, sponsorCount, entityCount } = input;

  // ── Variance driver ──────────────────────────────────────────────────────
  const primaryVarianceDriver = deriveVarianceDriver(input);
  const varianceExplanation = explainVariance(primaryVarianceDriver, input);

  // ── Covenant testing DSCR ────────────────────────────────────────────────
  const covenantTestingDscr = deriveCovenantDscr(sponsorCount, entityCount);
  const covenantRationale = explainCovenant(covenantTestingDscr, sponsorCount);

  // ── Flags ────────────────────────────────────────────────────────────────
  const flags = deriveFlags(input);

  return {
    dscrTriangle: {
      entity: entityDscr,
      uca: ucaDscr,
      global: globalDscr,
    },
    primaryVarianceDriver,
    varianceExplanation,
    covenantTestingDscr,
    covenantRationale,
    flags,
  };
}

// ---------------------------------------------------------------------------
// Variance driver logic
// ---------------------------------------------------------------------------

function deriveVarianceDriver(input: DscrReconciliationInput): VarianceDriver {
  const { entityDscr, ucaDscr, globalDscr } = input;

  // Need at least two non-null DSCRs to determine variance
  const available = [entityDscr, ucaDscr, globalDscr].filter(
    (v) => v != null,
  ).length;
  if (available < 2) return "UNKNOWN";

  // Global > Entity by > 0.10x → sponsors lifting coverage
  if (
    globalDscr != null &&
    entityDscr != null &&
    globalDscr - entityDscr > 0.1
  ) {
    return "SPONSOR_INCOME";
  }

  // Entity > UCA by > 0.10x → working capital burn
  if (entityDscr != null && ucaDscr != null && entityDscr - ucaDscr > 0.1) {
    return "WORKING_CAPITAL";
  }

  // All within 0.05x → no meaningful variance
  const vals = [entityDscr, ucaDscr, globalDscr].filter(
    (v): v is number => v != null,
  );
  if (vals.length >= 2) {
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    if (max - min <= 0.05) return "NONE";
  }

  return "UNKNOWN";
}

function explainVariance(
  driver: VarianceDriver,
  input: DscrReconciliationInput,
): string {
  switch (driver) {
    case "SPONSOR_INCOME":
      return (
        "Global DSCR exceeds entity DSCR because guarantor personal income " +
        "is lifting coverage. The entity alone would produce weaker debt service coverage."
      );
    case "WORKING_CAPITAL":
      return (
        "Entity DSCR exceeds UCA DSCR because the entity is consuming cash " +
        "on working capital changes that the accrual-based spread does not reflect."
      );
    case "OWNERSHIP_ADJUSTMENT":
      return (
        "DSCR variance is driven by ownership percentage adjustments " +
        "applied to the entity's cash flow contribution."
      );
    case "NONE":
      return "All three DSCR measures are closely aligned — no material variance.";
    case "UNKNOWN":
    default: {
      const available = [input.entityDscr, input.ucaDscr, input.globalDscr]
        .filter((v) => v != null).length;
      if (available < 2) {
        return "Insufficient DSCR data to determine variance. Complete extraction and pricing to populate all three measures.";
      }
      return "DSCR measures show variance but the primary driver could not be determined from available data.";
    }
  }
}

// ---------------------------------------------------------------------------
// Covenant testing DSCR logic
// ---------------------------------------------------------------------------

function deriveCovenantDscr(
  sponsorCount: number,
  _entityCount: number,
): CovenantDscr {
  // Sponsors with personal guarantees → Global DSCR governs
  if (sponsorCount > 0) return "GLOBAL";

  // Default: entity-level DSCR
  return "ENTITY";
}

function explainCovenant(
  dscr: CovenantDscr,
  sponsorCount: number,
): string {
  switch (dscr) {
    case "GLOBAL":
      return `Global DSCR governs covenant testing because ${sponsorCount} guarantor${sponsorCount > 1 ? "s" : ""} provide personal support.`;
    case "UCA":
      return "UCA DSCR governs covenant testing because the deal is collateralized by real estate with cash flow analysis.";
    case "ENTITY":
    default:
      return "Entity DSCR governs covenant testing as the primary measure of the borrower's debt service capacity.";
  }
}

// ---------------------------------------------------------------------------
// Flag derivation
// ---------------------------------------------------------------------------

function deriveFlags(input: DscrReconciliationInput): DscrFlag[] {
  const { entityDscr, globalDscr, globalCashFlow, entityCashFlowAvailable } =
    input;
  const flags: DscrFlag[] = [];

  // Global DSCR < 1.00x → FLAG
  if (globalDscr != null && globalDscr < 1.0) {
    flags.push({
      severity: "FLAG",
      message:
        "Global cash flow deficit — deal requires structural mitigants or additional collateral.",
    });
  }

  // Global > 1.25x but Entity < 1.10x → CAUTION
  if (
    globalDscr != null &&
    globalDscr >= 1.25 &&
    entityDscr != null &&
    entityDscr < 1.1
  ) {
    flags.push({
      severity: "CAUTION",
      message:
        "Entity DSCR is tight; deal depends on guarantor support to reach coverage threshold.",
    });
  }

  // Sponsor income > 50% of global cash flow → CAUTION
  if (
    globalCashFlow != null &&
    entityCashFlowAvailable != null &&
    globalCashFlow > 0 &&
    entityCashFlowAvailable >= 0
  ) {
    const sponsorContribution = globalCashFlow - entityCashFlowAvailable;
    if (sponsorContribution > globalCashFlow * 0.5) {
      flags.push({
        severity: "CAUTION",
        message:
          "More than half of global cash flow comes from guarantor personal income — entity is not self-supporting.",
      });
    }
  }

  // Entity DSCR < 1.00x (independent of global)
  if (
    entityDscr != null &&
    entityDscr < 1.0 &&
    (globalDscr == null || globalDscr >= 1.0)
  ) {
    flags.push({
      severity: "CAUTION",
      message:
        "Entity-level cash flow does not cover debt service without guarantor support.",
    });
  }

  return flags;
}
