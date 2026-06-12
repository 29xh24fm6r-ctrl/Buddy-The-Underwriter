/**
 * SPEC-CLASSIC-SPREAD-RATIO-CERTIFICATION-1 (Phase 5)
 *
 * Certify classic-spread coverage ratios so the renderer cannot present a mislabeled or
 * mathematically-unsafe ratio as a clean number. Guards:
 *   - Interest Coverage is NOT DSCR — distinct ratio classes; one can never be relabeled the other.
 *   - DSCR = cash-flow-available-for-debt-service ÷ annual debt service. The denominator must be
 *     real annual debt service: a missing / zero / sentinel-period denominator → unavailable or
 *     blocked (never infinite or clean). Interest expense or proposed debt service can never be
 *     silently substituted for actual annual debt service.
 *   - UCA DSCR, recurring/NCADS DSCR and proposed/pro-forma coverage are distinct classes;
 *     proposed coverage must be labeled proposed and can never certify as historical actual.
 *   - When a reported ratio fact exists, recompute from operands and reconcile within tolerance;
 *     a material mismatch blocks.
 *   - Numerator dependency (e.g. Phase 4 GCF): blocked → blocked; preliminary → preliminary/limited.
 *
 * Pure (no DB, no IO). Imports nothing from reconcileFinancialFacts / the canonical VM. No
 * PDF/row-builder/schema/route change — wiring is Phase 6.
 */

import {
  certifiedDirectFact,
  certifiedDerived,
  certifiedBlocked,
  certifiedUnavailable,
  type CertifiedSpreadValue,
} from "./certifiedSpreadValue";
import { auditRowFromValue, type CertifiedAuditRow } from "./certifiedSpreadAudit";
import type { GcfDependencyStatus } from "./certifiedGlobalCashFlow";

export type RatioType =
  | "DSCR_TRADITIONAL" // historical actual DSCR
  | "DSCR_UCA" // UCA cash-flow DSCR
  | "DSCR_NCADS" // recurring / normalized NCADS DSCR
  | "INTEREST_COVERAGE"
  | "DSCR_PROPOSED"; // proposed / pro-forma coverage

export type RatioClass = "historical" | "uca" | "ncads" | "proposed" | "interest_coverage";

export type DenominatorKind =
  | "annual_debt_service"
  | "proposed_debt_service"
  | "interest_expense"
  | "unknown";

export const RATIO_CLASS: Record<RatioType, RatioClass> = {
  DSCR_TRADITIONAL: "historical",
  DSCR_UCA: "uca",
  DSCR_NCADS: "ncads",
  INTEREST_COVERAGE: "interest_coverage",
  DSCR_PROPOSED: "proposed",
};

/** Which denominator kinds are valid for each ratio type. */
const ALLOWED_DENOMINATOR: Record<RatioType, DenominatorKind[]> = {
  DSCR_TRADITIONAL: ["annual_debt_service"],
  DSCR_UCA: ["annual_debt_service"],
  DSCR_NCADS: ["annual_debt_service"],
  INTEREST_COVERAGE: ["interest_expense"],
  DSCR_PROPOSED: ["proposed_debt_service", "annual_debt_service"],
};

/** Ratio types whose denominator must carry a trustworthy (non-sentinel) historical period. */
const REQUIRE_REAL_DENOMINATOR_PERIOD = new Set<RatioType>(["DSCR_TRADITIONAL", "DSCR_UCA", "DSCR_NCADS"]);

export type RatioOperand = {
  id: string | null;
  factKey: string;
  value: number | null;
  period: string | null;
  documentId: string | null;
  canonicalType: string | null;
  confidence: number | null;
  extractor: string | null;
  is_superseded?: boolean | null;
  resolution_status?: string | null;
};

export type RatioCertInput = {
  ratioType: RatioType;
  numerator: RatioOperand;
  denominator: RatioOperand & { kind: DenominatorKind };
  /** an existing ratio fact (e.g. GCF_DSCR) to reconcile the recomputed ratio against */
  reportedRatio?: RatioOperand | null;
  /** dependency status of the numerator (e.g. from Phase 4 GCF certification) */
  numeratorDependency?: GcfDependencyStatus;
};

export type RatioCertification = {
  ratioType: RatioType;
  ratioClass: RatioClass;
  value: CertifiedSpreadValue;
  preliminary: boolean;
  numerator: { value: number | null; source: string | null; period: string | null };
  denominator: { value: number | null; kind: DenominatorKind; source: string | null; period: string | null };
  computedRatio: number | null;
  reportedRatio: number | null;
  toleranceOk: boolean | null;
  dependencyStatus: GcfDependencyStatus;
  rejected: { factId: string | null; value: number | null; reason: string }[];
  reason: string;
};

const NON_SELECTABLE_STATUSES = new Set(["rejected", "system_invalidated"]);

function live<T extends RatioOperand>(op: T | null | undefined): T | null {
  if (!op) return null;
  if (op.is_superseded === true) return null;
  if (NON_SELECTABLE_STATUSES.has((op.resolution_status ?? "").toLowerCase())) return null;
  if (op.value === null) return null;
  return op;
}

function isSentinelOrUnknown(period: string | null): boolean {
  if (!period) return true;
  const m = /(\d{4})/.exec(period);
  return !m || parseInt(m[1], 10) < 2000;
}

function operandValue(op: RatioOperand): CertifiedSpreadValue {
  return certifiedDirectFact(op.value, {
    factId: op.id,
    factKey: op.factKey,
    documentId: op.documentId,
    canonicalType: op.canonicalType,
    confidence: op.confidence,
  });
}

function reconciles(computed: number, reported: number): boolean {
  return Math.abs(computed - reported) <= Math.max(0.05, 0.02 * Math.abs(reported));
}

export function certifyRatio(input: RatioCertInput): RatioCertification {
  const ratioClass = RATIO_CLASS[input.ratioType];
  const dependency: GcfDependencyStatus = input.numeratorDependency ?? "ok";
  const formulaName = input.ratioType;

  const num = live(input.numerator);
  const den = live(input.denominator) as (RatioOperand & { kind: DenominatorKind }) | null;
  const reported = live(input.reportedRatio ?? null);
  const rejected: RatioCertification["rejected"] = [];

  const base = {
    ratioType: input.ratioType,
    ratioClass,
    preliminary: false,
    numerator: { value: num?.value ?? null, source: num?.factKey ?? null, period: num?.period ?? null },
    denominator: { value: den?.value ?? null, kind: input.denominator.kind, source: den?.factKey ?? null, period: den?.period ?? null },
    computedRatio: null as number | null,
    reportedRatio: reported?.value ?? null,
    toleranceOk: null as boolean | null,
    dependencyStatus: dependency,
    rejected,
  };

  const finish = (value: CertifiedSpreadValue, reason: string, extra?: Partial<RatioCertification>): RatioCertification => {
    const cert: RatioCertification = { ...base, value, reason, ...extra };
    return cert;
  };

  // 1. Denominator KIND identity — never silently substitute the wrong denominator.
  if (!ALLOWED_DENOMINATOR[input.ratioType].includes(input.denominator.kind)) {
    const why =
      input.denominator.kind === "interest_expense"
        ? `cannot substitute interest expense for annual debt service in ${ratioClass} DSCR`
        : input.denominator.kind === "proposed_debt_service"
          ? `cannot present proposed debt service as ${ratioClass} (actual) DSCR — only proposed/pro-forma coverage may use it`
          : `denominator kind ${input.denominator.kind} is not valid for ${input.ratioType}`;
    return finish(certifiedBlocked(`${input.ratioType}: ${why}.`), why);
  }

  // 2. Numerator present.
  if (!num) {
    return finish(certifiedUnavailable(`${input.ratioType}: numerator unavailable.`), "numerator unavailable");
  }

  // 3. Denominator present / non-zero / trustworthy period.
  if (!den) {
    return finish(certifiedUnavailable(`${input.ratioType}: denominator (${input.denominator.kind}) unavailable — ratio cannot be computed.`), "denominator unavailable");
  }
  if (den.value === 0) {
    return finish(certifiedBlocked(`${input.ratioType}: denominator is 0 — ratio is undefined, not infinite/clean.`), "denominator is zero");
  }
  if (REQUIRE_REAL_DENOMINATOR_PERIOD.has(input.ratioType) && isSentinelOrUnknown(den.period)) {
    return finish(
      certifiedBlocked(`${input.ratioType}: annual debt service source period ${den.period ?? "unknown"} is sentinel/untrusted — cannot certify an actual DSCR.`),
      "denominator period sentinel/untrusted",
    );
  }

  const computed = (num.value as number) / (den.value as number);
  base.computedRatio = computed;

  // 4. Reconcile against a reported ratio when present.
  if (reported) {
    const ok = reconciles(computed, reported.value as number);
    base.toleranceOk = ok;
    if (!ok) {
      rejected.push({ factId: reported.id, value: reported.value, reason: `reported ratio ${reported.value} conflicts with computed ${computed.toFixed(4)} beyond tolerance.` });
      return finish(
        certifiedBlocked(`${input.ratioType}: reported ${reported.value} ≠ computed ${computed.toFixed(4)} (numerator ${num.value} ÷ denominator ${den.value}); cannot certify.`, [operandValue(num), operandValue(den)]),
        "reported vs computed mismatch",
      );
    }
  }

  // 5. Numerator dependency gate.
  if (dependency === "blocked") {
    return finish(
      certifiedBlocked(`${input.ratioType}: numerator depends on a blocked source (e.g. blocked GCF) — ratio cannot be certified.`, [operandValue(num), operandValue(den)]),
      "numerator dependency blocked",
    );
  }

  const derived = certifiedDerived(computed, formulaName, [operandValue(num), operandValue(den)]);

  if (dependency === "preliminary") {
    const value: CertifiedSpreadValue = {
      ...derived,
      caveats: [...derived.caveats, "Preliminary — numerator depends on a preliminary source; not a clean ratio certification."],
    };
    return finish(value, `Certified PRELIMINARY ${ratioClass} ratio = ${computed.toFixed(4)}.`, { preliminary: true });
  }

  return finish(derived, `Certified ${ratioClass} ratio = ${computed.toFixed(4)} (${num.value} ÷ ${den.value}).`);
}

/** Certify a set of ratio rows and collect their audit rows. */
export function certifyRatios(
  inputs: RatioCertInput[],
  period: string,
): { certifications: RatioCertification[]; auditRows: CertifiedAuditRow[] } {
  const certifications = inputs.map((i) => certifyRatio(i));
  const auditRows = certifications.map((c) => auditRowFromValue("ratios", c.ratioType, period, c.value));
  return { certifications, auditRows };
}
