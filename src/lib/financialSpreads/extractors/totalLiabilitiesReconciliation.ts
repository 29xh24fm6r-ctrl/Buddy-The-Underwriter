/**
 * SPEC-FINENGINE-EXTRACTION-RECONCILIATION-1 — Layer 2, Fix 2.
 *
 * Both extractor paths (the Gemini `businessTaxReturn` prompt and the
 * deterministic Schedule-L regex) capture Form 1120 Schedule L **line 28**
 * ("Total liabilities AND shareholders' equity") as `SL_TOTAL_LIABILITIES`.
 * Line 28 equals Total Assets, so the fact overstates liabilities massively
 * (OmniCare 2022: 3,268,740 instead of 1,528,384).
 *
 * Rather than patch every extractor path and every form variant (1120 / 1120-S
 * / 1065, whose Schedule-L line numbers differ), this is a **form-agnostic
 * post-extraction reconciliation** keyed off canonical component fact keys:
 *
 *   SL_TOTAL_LIABILITIES = SL_ACCOUNTS_PAYABLE
 *                        + SL_OPERATING_CURRENT_LIABILITIES
 *                        + SL_OTHER_LIABILITIES
 *                        + dedup(SL_LOANS_FROM_SHAREHOLDERS, SL_MORTGAGES_NOTES_BONDS)
 *
 * De-dup rule (mirrors buildFinancialModel's LONG_TERM_DEBT accumulation): when
 * the two debt lines carry the identical value it is the SAME loan reported on
 * Schedule L lines 19 and 20 — count it once, not twice.
 *
 * Safety guard: only override an existing `SL_TOTAL_LIABILITIES` when it is
 * missing OR matches the Total-Assets bug signature (line 28 ≈ Total Assets).
 * If the extractor produced a total that is NOT the line-28 value, trust it —
 * this prevents a partially-extracted component set (e.g. a QuickBooks balance
 * sheet missing one current-liability line) from clobbering a correct total.
 *
 * PURE — no IO, never throws. Operates on the pre-write item array so it covers
 * every extractor path through writeFactsBatch.
 */
import type { ExtractedLineItem } from "./shared";

/** Current + non-current liability lines summed directly (distinct categories). */
const DIRECT_LIABILITY_KEYS = [
  "SL_ACCOUNTS_PAYABLE",
  "SL_OPERATING_CURRENT_LIABILITIES",
  "SL_OTHER_LIABILITIES",
] as const;

/** Debt lines that may report the SAME loan twice (L19 + L20) — value-deduped. */
const DEBT_LIABILITY_KEYS = [
  "SL_LOANS_FROM_SHAREHOLDERS",
  "SL_MORTGAGES_NOTES_BONDS",
] as const;

const TOTAL_LIABILITIES_KEY = "SL_TOTAL_LIABILITIES";
const TOTAL_ASSETS_KEY = "SL_TOTAL_ASSETS";

const COMPONENT_KEYS: readonly string[] = [...DIRECT_LIABILITY_KEYS, ...DEBT_LIABILITY_KEYS];

/** Facts are grouped by their reporting period; fall back to start/marker. */
function periodKey(item: ExtractedLineItem): string {
  return item.periodEnd ?? item.periodStart ?? "__no_period__";
}

/**
 * A wrong total captured from Schedule L line 28 equals Total Assets (the
 * balance-sheet identity Assets = Liabilities + Equity). Treat near-equality
 * as the bug signature so OCR rounding does not defeat the guard.
 */
function matchesTotalAssetsBug(totalLiabilities: number, totalAssets: number): boolean {
  const tolerance = Math.max(1, Math.abs(totalAssets) * 0.001);
  return Math.abs(totalLiabilities - totalAssets) <= tolerance;
}

/**
 * Recompute `SL_TOTAL_LIABILITIES` from its components, per period. Returns a
 * NEW array; the input is never mutated.
 */
export function reconcileTotalLiabilities(items: ExtractedLineItem[]): ExtractedLineItem[] {
  const byPeriod = new Map<string, ExtractedLineItem[]>();
  for (const item of items) {
    const key = periodKey(item);
    const group = byPeriod.get(key);
    if (group) group.push(item);
    else byPeriod.set(key, [item]);
  }

  const result = [...items];
  const additions: ExtractedLineItem[] = [];

  for (const [pk, group] of byPeriod) {
    // Last-write-wins value map for the keys we care about.
    const valueByKey = new Map<string, number>();
    for (const item of group) valueByKey.set(item.factKey, item.value);

    const hasComponent = COMPONENT_KEYS.some((k) => valueByKey.has(k));
    if (!hasComponent) continue; // nothing to compute from — leave the total as-is

    const directSum = DIRECT_LIABILITY_KEYS.reduce((sum, k) => sum + (valueByKey.get(k) ?? 0), 0);
    // De-dup identical debt values (same loan on Schedule L lines 19 and 20).
    const distinctDebt = [
      ...new Set(DEBT_LIABILITY_KEYS.filter((k) => valueByKey.has(k)).map((k) => valueByKey.get(k)!)),
    ];
    const debtSum = distinctDebt.reduce((sum, v) => sum + v, 0);
    const computed = directSum + debtSum;

    const existingTotal = valueByKey.get(TOTAL_LIABILITIES_KEY);
    const totalAssets = valueByKey.get(TOTAL_ASSETS_KEY);

    // Only reconcile a missing total, or one that carries the line-28 bug
    // signature (≈ Total Assets). Never clobber an independently-correct total.
    const shouldApply =
      existingTotal === undefined ||
      (totalAssets !== undefined && matchesTotalAssetsBug(existingTotal, totalAssets));
    if (!shouldApply) continue;

    const idx = result.findIndex(
      (it) => it.factKey === TOTAL_LIABILITIES_KEY && periodKey(it) === pk,
    );
    if (idx >= 0) {
      const prev = result[idx];
      if (prev.value === computed) continue; // idempotent — nothing to change
      result[idx] = {
        ...prev,
        value: computed,
        provenance: {
          ...prev.provenance,
          calc: `reconciled: sum of Schedule L liability components (was ${prev.value})`,
        },
      };
    } else {
      // No total extracted — synthesize one from a representative component.
      const source = group.find((it) => COMPONENT_KEYS.includes(it.factKey))!;
      additions.push({
        factKey: TOTAL_LIABILITIES_KEY,
        value: computed,
        confidence: source.confidence,
        periodStart: source.periodStart,
        periodEnd: source.periodEnd,
        provenance: {
          ...source.provenance,
          calc: "reconciled: sum of Schedule L liability components (total not extracted)",
        },
      });
    }
  }

  return additions.length ? [...result, ...additions] : result;
}
