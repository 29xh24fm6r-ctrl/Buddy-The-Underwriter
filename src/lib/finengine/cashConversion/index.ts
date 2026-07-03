/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 5: Cash Conversion Engine.
 *
 * Measures whether accounting income converts into cash. The activity ratios
 * that already live in the central METRIC_REGISTRY (DSO/DPO/DIO/CCC and the two
 * turnovers) are computed by DELEGATING to the shared `evaluateMetric` path — no
 * formula is re-implemented here (safety rule 5). The genuinely new conversion
 * metrics (operating/free cash conversion, working-capital velocity, normalized
 * FCF) are computed inline with null-safe degradation.
 *
 * Missing-data degradation: any metric whose inputs are absent returns
 * `value: null` with the missing keys listed — never a fabricated number.
 * No false precision: days round to whole numbers, ratios to 2 decimals.
 *
 * Pure, no IO.
 */

import { evaluateMetric } from "@/lib/metrics/evaluateMetric";

export type MetricResult = {
  value: number | null;
  missingInputs: string[];
  precision: number;
};

export type CashConversionInput = {
  /** Canonical fact keys: TOTAL_REVENUE, COST_OF_GOODS_SOLD, ACCOUNTS_RECEIVABLE, INVENTORY, ACCOUNTS_PAYABLE. */
  facts: Record<string, number | null>;
  operatingCashFlow?: number | null;
  capex?: number | null;
  ebitda?: number | null;
  cashTaxes?: number | null;
  /** Increase in net working capital over the period (a use of cash). */
  deltaWorkingCapital?: number | null;
  /** Net working capital level (for velocity). */
  netWorkingCapital?: number | null;
};

export type CashConversion = {
  dso: MetricResult;
  dpo: MetricResult;
  dio: MetricResult;
  ccc: MetricResult;
  arTurnover: MetricResult;
  inventoryTurnover: MetricResult;
  operatingCashConversion: MetricResult;
  freeCashConversion: MetricResult;
  workingCapitalVelocity: MetricResult;
  normalizedFcf: MetricResult;
  warnings: string[];
};

const round = (v: number, precision: number): number => {
  const f = Math.pow(10, precision);
  return Math.round(v * f) / f;
};

/** Delegate a registry metric, then apply display precision. Never throws. */
function fromRegistry(metricId: string, facts: Record<string, number | null>, precision: number): MetricResult {
  const { value, missingInputs } = evaluateMetric(metricId, facts);
  return {
    value: value == null ? null : round(value, precision),
    missingInputs,
    precision,
  };
}

/** Null-safe ratio a/b with explicit missing-input tracking. */
function ratio(
  a: number | null | undefined,
  b: number | null | undefined,
  labels: [string, string],
  precision: number,
): MetricResult {
  const missing: string[] = [];
  if (a == null || !Number.isFinite(a)) missing.push(labels[0]);
  if (b == null || !Number.isFinite(b)) missing.push(labels[1]);
  if (missing.length) return { value: null, missingInputs: missing, precision };
  if (b === 0) return { value: null, missingInputs: [`${labels[1]}:zero`], precision };
  return { value: round((a as number) / (b as number), precision), missingInputs: [], precision };
}

export function computeCashConversion(input: CashConversionInput): CashConversion {
  const f = input.facts;
  const warnings: string[] = [];

  // ── Registry-delegated activity ratios ─────────────────────────────────────
  const dso = fromRegistry("DSO", f, 0);
  const dpo = fromRegistry("DPO", f, 0);
  const dio = fromRegistry("DIO", f, 0);
  const arTurnover = fromRegistry("AR_TURNOVER", f, 2);
  const inventoryTurnover = fromRegistry("INVENTORY_TURNOVER", f, 2);

  // CCC composes DSO+DIO-DPO; feed the computed days back through the registry.
  const ccc =
    dso.value != null && dio.value != null && dpo.value != null
      ? fromRegistry("CCC", { DSO: dso.value, DIO: dio.value, DPO: dpo.value }, 0)
      : {
          value: null,
          missingInputs: [...dso.missingInputs, ...dio.missingInputs, ...dpo.missingInputs],
          precision: 0,
        };

  // ── New conversion metrics (not in the registry) ───────────────────────────
  const operatingCashConversion = ratio(input.operatingCashFlow, input.ebitda, ["OPERATING_CASH_FLOW", "EBITDA"], 2);

  const fcfNumerator =
    input.operatingCashFlow != null && input.capex != null ? input.operatingCashFlow - input.capex : null;
  const freeCashConversion = ratio(fcfNumerator, input.ebitda, ["OPERATING_CASH_FLOW_LESS_CAPEX", "EBITDA"], 2);

  const workingCapitalVelocity = ratio(f.TOTAL_REVENUE, input.netWorkingCapital, ["TOTAL_REVENUE", "NET_WORKING_CAPITAL"], 2);

  // Normalized FCF = EBITDA − capex − cash taxes − ΔNWC. Requires EBITDA + capex;
  // optional taxes/ΔNWC degrade to 0 with a warning (documented assumption).
  let normalizedFcf: MetricResult;
  if (input.ebitda == null || input.capex == null) {
    const missing: string[] = [];
    if (input.ebitda == null) missing.push("EBITDA");
    if (input.capex == null) missing.push("CAPEX");
    normalizedFcf = { value: null, missingInputs: missing, precision: 0 };
  } else {
    const taxes = input.cashTaxes ?? 0;
    const dwc = input.deltaWorkingCapital ?? 0;
    if (input.cashTaxes == null) warnings.push("normalized_fcf_assumed_zero_cash_taxes");
    if (input.deltaWorkingCapital == null) warnings.push("normalized_fcf_assumed_zero_delta_wc");
    normalizedFcf = { value: round(input.ebitda - input.capex - taxes - dwc, 0), missingInputs: [], precision: 0 };
  }

  return {
    dso,
    dpo,
    dio,
    ccc,
    arTurnover,
    inventoryTurnover,
    operatingCashConversion,
    freeCashConversion,
    workingCapitalVelocity,
    normalizedFcf,
    warnings,
  };
}
