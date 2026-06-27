/**
 * SPEC-FINENGINE-SHADOW-EBITDA-1 — pure EBITDA shadow runner.
 *
 * For one deal's facts: build per-period SpreadInputs (adapter), invoke the REAL
 * engine method (adjustedEbitdaMethod + coreOperatingEarnings) to produce shadow
 * values, derive the golden-set independently from the same facts, read the
 * legacy EBITDA rows, and classify via compareProducers.
 *
 * Pure — no DB. The script `scripts/finengine-shadow-ebitda.ts` loads rows and
 * calls this. NG1: writes nothing; all shadow values live in memory / the report.
 */

import { adjustedEbitdaMethod } from "@/lib/finengine/methods/adjustedEbitda";
import { coreOperatingEarnings } from "@/lib/finengine/methods/foundation";
import {
  buildSpreadInputsByPeriod,
  type AdapterFactRow,
} from "@/lib/finengine/shadow/dealInputAdapter";
import {
  goldenConservativeEbitda,
  goldenAdjustedEbitda,
} from "@/lib/finengine/shadow/ebitdaGoldenSet";
import {
  compareProducers,
  type ShadowValue,
  type GoldenSetEntry,
  type ShadowReport,
} from "@/lib/finengine/shadow/reconcile";

const SPEC = "SPEC-FINENGINE-SHADOW-EBITDA-1";

export type PeriodEbitdaDetail = {
  ownerType: string;
  fiscalPeriodEnd: string;
  isAggregate: boolean;
  base: { key: string; value: number | null };
  engineEbitda: number | null; // coreOperatingEarnings(inputs).value (conservative EBITDA)
  engineAdjustedEbitda: number | null; // adjustedEbitdaMethod.compute().cashFlowAvailable
  goldenEbitda: number | null; // independent
  goldenAdjustedEbitda: number | null; // independent
  legacyEbitda: number | null;
  warnings: string[];
};

export type EbitdaShadowResult = {
  dealId: string;
  periods: PeriodEbitdaDetail[];
  report: ShadowReport;
};

export function runEbitdaShadow(dealId: string, rows: AdapterFactRow[]): EbitdaShadowResult {
  const periods = buildSpreadInputsByPeriod(rows);

  // Legacy EBITDA rows (the bug, typically superseded) keyed by owner+period.
  const legacy: ShadowValue[] = rows
    .filter((r) => r.fact_key === "EBITDA")
    .map((r) => ({
      dealId,
      factKey: "EBITDA",
      ownerType: r.owner_type,
      fiscalPeriodEnd: r.fact_period_end,
      value: r.fact_value_num,
    }));

  const shadow: ShadowValue[] = [];
  const goldenSet: GoldenSetEntry[] = [];
  const detail: PeriodEbitdaDetail[] = [];

  for (const p of periods) {
    const core = coreOperatingEarnings(p.inputs);
    const adj = adjustedEbitdaMethod.compute(p.inputs, () => {
      throw new Error("policy not used");
    });
    const gCons = goldenConservativeEbitda(p.inputs.facts);
    const gAdj = goldenAdjustedEbitda(p.inputs.facts);

    const legacyRow = legacy.find((l) => l.ownerType === p.ownerType && l.fiscalPeriodEnd === p.fiscalPeriodEnd);

    // Shadow values (engine output).
    shadow.push({ dealId, factKey: "EBITDA", ownerType: p.ownerType, fiscalPeriodEnd: p.fiscalPeriodEnd, value: core.value });
    shadow.push({ dealId, factKey: "ADJUSTED_EBITDA", ownerType: p.ownerType, fiscalPeriodEnd: p.fiscalPeriodEnd, value: adj.cashFlowAvailable });

    // Golden-set (independent expected values).
    goldenSet.push({
      dealId, factKey: "EBITDA", ownerType: p.ownerType, fiscalPeriodEnd: p.fiscalPeriodEnd,
      expectedNewValue: gCons.conservativeEbitda,
      rationale: `EBITDA = ${gCons.baseKey}(${gCons.base ?? "—"}) + interest(${gCons.interest}) + dep(${gCons.depreciation}) + amort(${gCons.amortization}); C-corp pre-tax base, no taxes added back.`,
      spec: SPEC,
    });
    goldenSet.push({
      dealId, factKey: "ADJUSTED_EBITDA", ownerType: p.ownerType, fiscalPeriodEnd: p.fiscalPeriodEnd,
      expectedNewValue: gAdj,
      rationale: "ADJUSTED = conservative EBITDA + owner-comp excess over market replacement + §179 acceleration only.",
      spec: SPEC,
    });

    detail.push({
      ownerType: p.ownerType,
      fiscalPeriodEnd: p.fiscalPeriodEnd,
      isAggregate: p.isAggregate,
      base: { key: core.base.key, value: core.base.value },
      engineEbitda: core.value,
      engineAdjustedEbitda: adj.cashFlowAvailable,
      goldenEbitda: gCons.conservativeEbitda,
      goldenAdjustedEbitda: gAdj,
      legacyEbitda: legacyRow?.value ?? null,
      warnings: [...p.warnings, ...gCons.warnings],
    });
  }

  const report = compareProducers(legacy, shadow, goldenSet);
  return { dealId, periods: detail, report };
}
