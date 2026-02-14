/**
 * Snapshot Hard Validation
 *
 * Ensures required facts exist before standard spread render.
 * No NaN, no Infinity, no divide-by-zero.
 * Returns structured errors + warnings — never throws.
 */

import type { DealFinancialSnapshotV1, SnapshotMetricValue } from "@/lib/deals/financialSnapshotCore";
import type { BusinessModel } from "@/lib/metrics/registry";
import { METRIC_REGISTRY } from "@/lib/metrics/registry";

export type ValidationIssue = "missing" | "nan" | "infinite" | "divide_by_zero";

export type ValidationEntry = {
  metric: string;
  issue: ValidationIssue;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationEntry[];
  warnings: ValidationEntry[];
};

// Metrics required for each business model to produce a valid standard spread.
const REQUIRED_METRICS: Record<BusinessModel, string[]> = {
  REAL_ESTATE: [
    "noi_ttm",
    "total_income_ttm",
    "annual_debt_service",
    "dscr",
    "ltv_gross",
    "collateral_gross_value",
    "bank_loan_total",
  ],
  OPERATING_COMPANY: [
    "revenue",
    "ebitda",
    "annual_debt_service",
    "dscr",
    "total_assets",
    "total_liabilities",
  ],
  MIXED: [
    "annual_debt_service",
    "dscr",
    "total_assets",
    "total_liabilities",
    "bank_loan_total",
  ],
};

// Metrics where the denominator could be zero (divide-by-zero check).
const RATIO_CHECKS: Array<{ metric: string; denominator: string }> = [
  { metric: "dscr", denominator: "annual_debt_service" },
  { metric: "dscr_stressed_300bps", denominator: "annual_debt_service" },
  { metric: "ltv_gross", denominator: "collateral_gross_value" },
  { metric: "ltv_net", denominator: "collateral_net_value" },
  { metric: "debt_to_equity", denominator: "net_worth" },
  { metric: "current_ratio", denominator: "total_liabilities" },
];

function getMetricValue(snapshot: DealFinancialSnapshotV1, metric: string): SnapshotMetricValue | undefined {
  return (snapshot as any)[metric] as SnapshotMetricValue | undefined;
}

/**
 * Validate a snapshot for standard spread render readiness.
 *
 * @param snapshot - The financial snapshot to validate
 * @param businessModel - Which business model classification to validate against
 * @returns ValidationResult with errors (block render) and warnings (render with notes)
 */
export function validateSnapshotForRender(
  snapshot: DealFinancialSnapshotV1,
  businessModel: BusinessModel,
): ValidationResult {
  const errors: ValidationEntry[] = [];
  const warnings: ValidationEntry[] = [];

  // 1. Check required metrics are present (non-null value_num)
  const required = REQUIRED_METRICS[businessModel] ?? REQUIRED_METRICS.MIXED;
  for (const metricName of required) {
    const mv = getMetricValue(snapshot, metricName);
    if (!mv || mv.value_num === null || mv.value_num === undefined) {
      errors.push({ metric: metricName, issue: "missing" });
    }
  }

  // 2. Scan all metrics for NaN / Infinity
  const allMetricKeys = Object.keys(snapshot).filter((k) => {
    const v = (snapshot as any)[k];
    return v && typeof v === "object" && "value_num" in v;
  });

  for (const key of allMetricKeys) {
    const mv = (snapshot as any)[key] as SnapshotMetricValue;
    if (mv.value_num !== null && mv.value_num !== undefined) {
      if (typeof mv.value_num === "number") {
        if (Number.isNaN(mv.value_num)) {
          errors.push({ metric: key, issue: "nan" });
        } else if (!Number.isFinite(mv.value_num)) {
          errors.push({ metric: key, issue: "infinite" });
        }
      }
    }
  }

  // 3. Check for divide-by-zero risks on ratio metrics
  for (const check of RATIO_CHECKS) {
    const denomMv = getMetricValue(snapshot, check.denominator);
    const ratioMv = getMetricValue(snapshot, check.metric);

    if (denomMv?.value_num === 0 && ratioMv?.value_num !== null) {
      warnings.push({ metric: check.metric, issue: "divide_by_zero" });
    }
  }

  // 4. Warn about computed metrics that the registry expects but snapshot lacks
  const applicableMetrics = Object.values(METRIC_REGISTRY).filter(
    (def) => def.applicableTo.includes(businessModel),
  );

  for (const def of applicableMetrics) {
    const snapshotKey = def.id.toLowerCase();
    const mv = getMetricValue(snapshot, snapshotKey);
    if (!mv || mv.value_num === null) {
      // Only warn if not already in required (which would be an error)
      if (!required.includes(snapshotKey)) {
        warnings.push({ metric: snapshotKey, issue: "missing" });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Infer business model from snapshot data.
 * If NOI / rental income present → REAL_ESTATE.
 * If revenue / EBITDA present → OPERATING_COMPANY.
 * If both → MIXED.
 */
export function inferBusinessModel(
  snapshot: DealFinancialSnapshotV1,
): BusinessModel {
  const hasRE = (snapshot.noi_ttm?.value_num ?? null) !== null
    || (snapshot.total_income_ttm?.value_num ?? null) !== null;
  const hasOP = (snapshot.revenue?.value_num ?? null) !== null
    || (snapshot.ebitda?.value_num ?? null) !== null;

  if (hasRE && hasOP) return "MIXED";
  if (hasOP) return "OPERATING_COMPANY";
  return "REAL_ESTATE"; // default
}
