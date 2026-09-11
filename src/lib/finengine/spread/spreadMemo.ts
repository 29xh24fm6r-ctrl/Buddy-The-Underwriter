/**
 * SPEC-FINENGINE-LIVE-SPREAD-1 — follow-on: surface the DealSpread into the memo.
 *
 * `buildCreditMemo` already renders from certified analytical objects but nothing
 * fed its `metrics` seam from the live engine. This module is the bridge: it turns
 * a computed `DealSpread` into (a) `MetricResult[]` for `MemoInputs.metrics` and
 * (b) a ready-to-render spread `MemoSection` — the explained, multi-period credit
 * spread with red flags and the validation/cutover status.
 *
 * Pure — no DB, no fact writes, no rendering side-effects. It READS the spread and
 * FORMATS it (the §2.1 "math drives the memo, the memo never drives the math"
 * wall; G4). The eventual production wiring (memo API / borrower report) consumes
 * these objects; this module does not touch live rendering.
 */

import type { MetricResult } from "@/lib/finengine/contracts";
import type { DealSpread } from "@/lib/finengine/spread/dealSpread";
import type { MemoSection } from "@/lib/finengine/memo/buildCreditMemo";
import { SENTINEL_PERIOD, type EntityScope } from "@/lib/finengine/shadow/dealInputAdapter";

const isReal = (p: string) => p !== SENTINEL_PERIOD && p !== "SERIES" && /^\d{4}-\d{2}-\d{2}$/.test(p);

/** The chronological real periods present for a scope (ascending). */
export function realPeriods(spread: DealSpread, scope: EntityScope, entityId?: string | null): string[] {
  return [...new Set(spread.cells.filter((c) => c.scope === scope && isReal(c.period) &&
    (entityId === undefined || (c.entityId ?? null) === entityId)).map((c) => c.period))].sort();
}

function latestRealPeriod(spread: DealSpread, scope: EntityScope, entityId?: string | null): string | null {
  const ps = realPeriods(spread, scope, entityId);
  return ps.length ? ps[ps.length - 1] : null;
}

/**
 * One scope+period's cells as `MetricResult[]` for `MemoInputs.metrics`. The
 * interpretation (meaning + deterministic signal) is folded into `explanation`
 * so the memo's metric list is self-describing; `passesFloor` mirrors the
 * interpretation rating (flag/weak ⇒ does not pass).
 */
export function dealSpreadToMetricResults(spread: DealSpread, scope: EntityScope = "BUSINESS", period?: string, entityId?: string | null): MetricResult[] {
  // MetricResult has no entity dimension. An unscoped scalar list cannot represent
  // multiple entities, even if their latest periods differ.
  const entities = new Set(spread.cells.filter((c) => c.scope === scope && isReal(c.period)).map((c) => c.entityId ?? null));
  if (entityId === undefined && entities.size > 1) return [];
  const selectedEntity = entityId === undefined ? [...entities][0] : entityId;
  const p = period ?? latestRealPeriod(spread, scope, selectedEntity);
  if (!p) return [];
  return spread.cells
    .filter((c) => c.scope === scope && (c.entityId ?? null) === selectedEntity && c.period === p && c.value != null)
    .map((c) => {
      const i = c.interpretation;
      const passesFloor = c.rating === "flag" || c.rating === "weak" ? false : c.rating === "strong" || c.rating === "adequate" ? true : undefined;
      return {
        metric: c.metric,
        value: c.value,
        inputs: c.inputs,
        explanation: `${i.meaning} ${i.signal}`.trim(),
        passesFloor,
      } satisfies MetricResult;
    });
}

const HEADLINE = [
  "EBITDA", "DSCR", "GCF_DSCR", "CURRENT_RATIO", "QUICK_RATIO", "DEBT_TO_EQUITY", "DEBT_TO_ETNW",
  "LEVERAGE_TOTAL", "GROSS_MARGIN", "OPERATING_MARGIN", "NET_MARGIN", "ROE", "ASSET_TURNOVER",
  "ALTMAN_Z_DOUBLE_PRIME", "ALTMAN_Z_PRIME",
];

function fmtVal(metric: string, v: number | null): string {
  if (v == null) return "—";
  if (metric === "EBITDA" || /_RECONCILIATION$/.test(metric)) return `$${Math.round(v).toLocaleString("en-US")}`;
  if (/MARGIN|RATIO_PCT|GROWTH|ROE|ROA|ROIC|ROCE|EQUITY_RATIO|DEBT_TO_ASSETS|LIABILITIES_TO_ASSETS/.test(metric)) return `${(v * 100).toFixed(1)}%`;
  if (/RATIO|DSCR|FCCR|ICR|LEVERAGE|DEBT_TO|TURNOVER|MULTIPLIER|ALTMAN/.test(metric)) return `${v.toFixed(2)}x`.replace("xx", "x");
  if (/DSO|DIO|DPO|CYCLE|INTERVAL|DAYS/.test(metric)) return `${Math.round(v)}d`;
  return v.toFixed(2);
}

/**
 * The credit-spread `MemoSection`: a multi-period table of headline metrics with
 * deterministic ratings, the red flags the interpretation layer fired, and the
 * validation/cutover status (when supplied). `hasData` is false on an empty spread.
 */
export function buildSpreadMemoSection(
  spread: DealSpread,
  opts?: { scope?: EntityScope; entityId?: string | null; validation?: { unexpected: number; cutoverBlocked: boolean; reason?: string } },
): MemoSection {
  const scope = opts?.scope ?? "BUSINESS";
  const periods = realPeriods(spread, scope, opts?.entityId);
  const hasData = periods.length > 0;

  const lines: string[] = [];
  if (hasData) {
    const entities = [...new Set(spread.cells.filter((c) => c.scope === scope && isReal(c.period) &&
      (opts?.entityId === undefined || (c.entityId ?? null) === opts.entityId)).map((c) => c.entityId ?? null))].sort();
    if (entities.length > 1) lines.push("Multiple entities: metrics below remain separate. Select an entity before using a borrower-level ratio.");
    for (const entityId of entities) {
      const entityPeriods = realPeriods(spread, scope, entityId);
      lines.push(`Credit spread — ${scope.toLowerCase()} entity${entityId ? ` ${entityId}` : " (unassigned)"}, ${entityPeriods.length} period(s): ${entityPeriods.join(", ")}.`);

      // Headline metric rows: metric → value per period, with the latest period's rating.
      const cellAt = (metric: string, period: string) => spread.cells.find((c) => c.scope === scope && (c.entityId ?? null) === entityId && c.metric === metric && c.period === period);
      const present = HEADLINE.filter((m) => entityPeriods.some((p) => cellAt(m, p)?.value != null));
      for (const metric of present) {
        const cols = entityPeriods.map((p) => fmtVal(metric, cellAt(metric, p)?.value ?? null)).join("  |  ");
        const last = cellAt(metric, entityPeriods[entityPeriods.length - 1]);
        lines.push(`  ${metric}: ${cols}  [${last?.rating ?? "n/a"}]`);
      }

      // Red flags across all periods (deduped, capped).
      const flags = [...new Set(
        spread.cells.filter((c) => c.scope === scope && (c.entityId ?? null) === entityId).flatMap((c) => c.interpretation.redFlags.map((f) => `${c.period}: ${f}`)),
      )];
      if (flags.length) {
        lines.push("Red flags:");
        for (const f of flags.slice(0, 12)) lines.push(`  ⚠ ${f}`);
        if (flags.length > 12) lines.push(`  …and ${flags.length - 12} more.`);
      }
    }

    // Validation / cutover status (when the caller ran validateSpread).
    if (opts?.validation) {
      const { unexpected, cutoverBlocked } = opts.validation;
      lines.push(
        cutoverBlocked
            ? `Validation: ${opts.validation.reason ?? `${unexpected} UNEXPECTED divergence(s) vs the independent golden`} — CUTOVER BLOCKED; analyst review required.`
          : `Validation: engine agrees with the independent golden (no unexpected divergences) — spread is cutover-clean.`,
      );
    }
  }

  return {
    key: "credit_spread",
    title: "Credit Spread (finengine)",
    body: hasData ? lines.join("\n") : "Credit Spread: data not yet available.",
    hasData,
  };
}

/** Both contributions at once, to feed `MemoInputs.metrics` and append the section. */
export function spreadToMemoContribution(
  spread: DealSpread,
  opts?: { scope?: EntityScope; entityId?: string | null; validation?: { unexpected: number; cutoverBlocked: boolean; reason?: string } },
): { metrics: MetricResult[]; section: MemoSection } {
  const scope = opts?.scope ?? "BUSINESS";
  return { metrics: dealSpreadToMetricResults(spread, scope, undefined, opts?.entityId), section: buildSpreadMemoSection(spread, opts) };
}
