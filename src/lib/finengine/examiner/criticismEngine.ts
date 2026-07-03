/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 12: Examiner Criticism Engine.
 *
 * Teaches Buddy what a regulator / loan reviewer would criticize. Given a
 * consolidated credit picture (the outputs of the other engines), it produces
 * evidence-backed criticisms, each with severity, mitigants, residual risk, and
 * a recommended condition. Pure + deterministic. It criticizes; it never clears.
 *
 * Every criticism cites its evidence — no criticism is emitted without the value
 * that triggered it.
 */

import type { PolicyContext } from "@/lib/finengine/contracts";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";

export type CriticismSeverity = "low" | "moderate" | "high";

export type CriticismCategory =
  | "policy_exception"
  | "documentation"
  | "repayment"
  | "collateral"
  | "monitoring"
  | "guarantor"
  | "stale_information";

export type Criticism = {
  code: string;
  category: CriticismCategory;
  severity: CriticismSeverity;
  criticism: string;
  evidence: string[];
  mitigants: string[];
  /** Residual risk after mitigants: unchanged severity if none, softened if present. */
  residualRisk: CriticismSeverity;
  recommendedCondition: string;
};

export type ExaminerInput = {
  dscr?: number | null;
  stressedDscr?: number | null;
  /** Discounted collateral coverage (1.0 = fully secured). */
  collateralCoverage?: number | null;
  appraisalAgeMonths?: number | null;
  financialsAgeMonths?: number | null;
  missingDocuments?: string[];
  policyExceptions?: { policy: string; approved: boolean }[];
  guarantor?: { hasGuarantor: boolean; globalDscr?: number | null };
  monitoring?: {
    covenantsSet: boolean;
    borrowingBaseRequired?: boolean;
    borrowingBaseReceived?: boolean;
  };
  /** Optional caller-supplied mitigants keyed by criticism code. */
  mitigants?: Record<string, string[]>;
  /** Policy resolution context (product/tenant) — resolves DSCR floor via the registry (NG4). */
  ctx?: PolicyContext;
};

const SEVERITY_RANK: Record<CriticismSeverity, number> = { low: 1, moderate: 2, high: 3 };

/** One notch softer, floored at low. */
function soften(sev: CriticismSeverity): CriticismSeverity {
  if (sev === "high") return "moderate";
  if (sev === "moderate") return "low";
  return "low";
}

function finalize(
  input: ExaminerInput,
  c: Omit<Criticism, "mitigants" | "residualRisk">,
): Criticism {
  const mitigants = input.mitigants?.[c.code] ?? [];
  const residualRisk = mitigants.length > 0 ? soften(c.severity) : c.severity;
  return { ...c, mitigants, residualRisk };
}

// ── Detectors ─────────────────────────────────────────────────────────────────

export function detectPolicyExceptions(input: ExaminerInput): Criticism[] {
  return (input.policyExceptions ?? [])
    .filter((e) => !e.approved)
    .map((e) =>
      finalize(input, {
        code: `policy_exception:${e.policy}`,
        category: "policy_exception",
        severity: "high",
        criticism: `Unapproved policy exception: ${e.policy}.`,
        evidence: [`policy=${e.policy}`, "approved=false"],
        recommendedCondition: `Obtain documented approval for the ${e.policy} exception at the appropriate authority level.`,
      }),
    );
}

export function detectDocumentationWeakness(input: ExaminerInput): Criticism[] {
  const missing = input.missingDocuments ?? [];
  if (missing.length === 0) return [];
  const severity: CriticismSeverity = missing.length >= 3 ? "high" : "moderate";
  return [
    finalize(input, {
      code: "documentation:missing_financials",
      category: "documentation",
      severity,
      criticism: `Loan file is missing required documentation (${missing.length} item(s)).`,
      evidence: missing.map((d) => `missing=${d}`),
      recommendedCondition: `Obtain prior to closing: ${missing.join(", ")}.`,
    }),
  ];
}

export function detectRepaymentWeakness(input: ExaminerInput): Criticism[] {
  const out: Criticism[] = [];
  // DSCR floor resolved from the registry (NG4) — never hardcoded here.
  const dscrFloor = resolvePolicy("dscr_floor", input.ctx).effective ?? 1.2;
  const dscrThinCeiling = dscrFloor + 0.1;
  if (input.dscr != null) {
    if (input.dscr < dscrFloor) {
      out.push(
        finalize(input, {
          code: "repayment:weak_dscr",
          category: "repayment",
          severity: "high",
          criticism: `Debt service coverage is weak at ${input.dscr.toFixed(2)}x.`,
          evidence: [`dscr=${input.dscr.toFixed(2)}`],
          recommendedCondition: `Require additional cash-flow support or reduce debt to restore ≥${dscrThinCeiling.toFixed(2)}x coverage.`,
        }),
      );
    } else if (input.dscr < dscrThinCeiling) {
      out.push(
        finalize(input, {
          code: "repayment:thin_dscr",
          category: "repayment",
          severity: "moderate",
          criticism: `Debt service coverage is thin at ${input.dscr.toFixed(2)}x.`,
          evidence: [`dscr=${input.dscr.toFixed(2)}`],
          recommendedCondition: "Set a DSCR covenant and monitor quarterly.",
        }),
      );
    }
  }
  if (input.stressedDscr != null && input.stressedDscr < 1.0) {
    out.push(
      finalize(input, {
        code: "repayment:stressed_dscr_below_breakeven",
        category: "repayment",
        severity: "high",
        criticism: `Stressed DSCR falls below breakeven at ${input.stressedDscr.toFixed(2)}x.`,
        evidence: [`stressedDscr=${input.stressedDscr.toFixed(2)}`],
        recommendedCondition: "Document sensitivity mitigants (guarantor support, rate hedge) or decline.",
      }),
    );
  }
  return out;
}

export function detectCollateralWeakness(input: ExaminerInput): Criticism[] {
  if (input.collateralCoverage == null || input.collateralCoverage >= 1) return [];
  const gap = 1 - input.collateralCoverage;
  const severity: CriticismSeverity = gap > 0.25 ? "high" : "moderate";
  return [
    finalize(input, {
      code: "collateral:shortfall",
      category: "collateral",
      severity,
      criticism: `Collateral coverage is ${(input.collateralCoverage * 100).toFixed(0)}% — loan is not fully secured.`,
      evidence: [`collateralCoverage=${input.collateralCoverage.toFixed(2)}`],
      recommendedCondition: "Take all available collateral and/or require additional support to close the shortfall.",
    }),
  ];
}

export function detectMonitoringWeakness(input: ExaminerInput): Criticism[] {
  const m = input.monitoring;
  if (!m) return [];
  const out: Criticism[] = [];
  if (!m.covenantsSet) {
    out.push(
      finalize(input, {
        code: "monitoring:no_covenants",
        category: "monitoring",
        severity: "moderate",
        criticism: "No financial covenants are set for ongoing monitoring.",
        evidence: ["covenantsSet=false"],
        recommendedCondition: "Establish a covenant package appropriate to product and risk.",
      }),
    );
  }
  if (m.borrowingBaseRequired && !m.borrowingBaseReceived) {
    out.push(
      finalize(input, {
        code: "monitoring:missing_borrowing_base",
        category: "monitoring",
        severity: "high",
        criticism: "Borrowing base reporting is required but not received.",
        evidence: ["borrowingBaseRequired=true", "borrowingBaseReceived=false"],
        recommendedCondition: "Require a current borrowing-base certificate before further advances.",
      }),
    );
  }
  return out;
}

export function detectGuarantorWeakness(input: ExaminerInput): Criticism[] {
  const g = input.guarantor;
  if (!g) return [];
  const out: Criticism[] = [];
  if (!g.hasGuarantor) {
    out.push(
      finalize(input, {
        code: "guarantor:none",
        category: "guarantor",
        severity: "moderate",
        criticism: "No guarantor support on the credit.",
        evidence: ["hasGuarantor=false"],
        recommendedCondition: "Obtain personal guaranty from principal owner(s).",
      }),
    );
  } else if (g.globalDscr != null && g.globalDscr < 1.0) {
    out.push(
      finalize(input, {
        code: "guarantor:weak_global",
        category: "guarantor",
        severity: "moderate",
        criticism: `Global (guarantor) DSCR is weak at ${g.globalDscr.toFixed(2)}x.`,
        evidence: [`globalDscr=${g.globalDscr.toFixed(2)}`],
        recommendedCondition: "Confirm guarantor liquidity and contingent-liability capacity.",
      }),
    );
  }
  return out;
}

export function detectStaleInformation(input: ExaminerInput): Criticism[] {
  const out: Criticism[] = [];
  if (input.appraisalAgeMonths != null && input.appraisalAgeMonths > 12) {
    out.push(
      finalize(input, {
        code: "stale:appraisal",
        category: "stale_information",
        severity: "moderate",
        criticism: `Appraisal is ${input.appraisalAgeMonths} months old.`,
        evidence: [`appraisalAgeMonths=${input.appraisalAgeMonths}`],
        recommendedCondition: "Obtain a current appraisal or evaluation before closing.",
      }),
    );
  }
  if (input.financialsAgeMonths != null && input.financialsAgeMonths > 18) {
    out.push(
      finalize(input, {
        code: "stale:financials",
        category: "stale_information",
        severity: input.financialsAgeMonths > 24 ? "high" : "moderate",
        criticism: `Financial statements are ${input.financialsAgeMonths} months old.`,
        evidence: [`financialsAgeMonths=${input.financialsAgeMonths}`],
        recommendedCondition: "Obtain current interim and fiscal-year-end financials.",
      }),
    );
  }
  return out;
}

export type ExaminerReview = {
  criticisms: Criticism[];
  highCount: number;
  moderateCount: number;
  lowCount: number;
};

/** Run every detector and return criticisms sorted most-severe first. */
export function runExaminerReview(input: ExaminerInput): ExaminerReview {
  const criticisms = [
    ...detectPolicyExceptions(input),
    ...detectDocumentationWeakness(input),
    ...detectRepaymentWeakness(input),
    ...detectCollateralWeakness(input),
    ...detectMonitoringWeakness(input),
    ...detectGuarantorWeakness(input),
    ...detectStaleInformation(input),
  ].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  return {
    criticisms,
    highCount: criticisms.filter((c) => c.severity === "high").length,
    moderateCount: criticisms.filter((c) => c.severity === "moderate").length,
    lowCount: criticisms.filter((c) => c.severity === "low").length,
  };
}
