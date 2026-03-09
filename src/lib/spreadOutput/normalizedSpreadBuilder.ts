/**
 * Normalized Spread Builder — Panel 2
 *
 * Builds the year-over-year normalized spread table with QoE adjustments.
 * Pure function — no DB, no server imports.
 */

import type { SpreadOutputInput, NormalizedSpread, NormalizedLineItem, SpreadAdjustment, LineItemCategory } from "./types";
import { getSpreadTemplate } from "./spreadTemplateRegistry";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function buildNormalizedSpread(input: SpreadOutputInput): NormalizedSpread {
  const template = getSpreadTemplate(input.deal_type);
  const years = [...input.years_available].sort((a, b) => a - b);

  const lineItems: NormalizedLineItem[] = template.line_item_order.map((item) => {
    const values: NormalizedLineItem["values"] = {};

    for (let i = 0; i < years.length; i++) {
      const year = years[i];
      const reported = getValueForYear(input, item.canonical_key, year);
      const adjustments = getAdjustmentsForKey(input, item.canonical_key);
      const adjustmentTotal = adjustments.reduce((sum, a) => sum + a.amount, 0);
      const normalized = reported !== null
        ? reported + (adjustments.length > 0 ? adjustmentTotal : 0)
        : null;

      // Trend vs prior year
      let trend: "up" | "down" | "flat" | null = null;
      let trendPct: number | null = null;

      if (i > 0) {
        const priorYear = years[i - 1];
        const priorReported = getValueForYear(input, item.canonical_key, priorYear);
        const priorNormalized = priorReported !== null
          ? priorReported + (adjustments.length > 0 ? adjustmentTotal : 0)
          : null;
        const current = normalized ?? reported;
        const prior = priorNormalized ?? priorReported;

        if (current !== null && prior !== null && prior !== 0) {
          trendPct = ((current - prior) / Math.abs(prior)) * 100;
          if (trendPct > 2) trend = "up";
          else if (trendPct < -2) trend = "down";
          else trend = "flat";
          trendPct = Math.round(trendPct * 10) / 10;
        }
      }

      values[year] = {
        reported,
        adjustments: reported !== null ? adjustments : [],
        normalized: adjustments.length > 0 ? normalized : reported,
        trend,
        trend_pct: trendPct,
      };
    }

    return {
      label: item.label,
      canonical_key: item.canonical_key,
      values,
      category: item.category as LineItemCategory,
    };
  });

  return { years, line_items: lineItems };
}

// ---------------------------------------------------------------------------
// Value lookup — year-specific key only
// Generic key fallback was removed — it caused last-write-wins pollution
// across all periods when a key was missing for a given year.
// ---------------------------------------------------------------------------

function getValueForYear(
  input: SpreadOutputInput,
  canonicalKey: string,
  year: number,
): number | null {
  const facts = input.canonical_facts;

  // Year-specific key (e.g., "TOTAL_REVENUE_2023")
  const yearKey = `${canonicalKey}_${year}`;
  const yearVal = toNum(facts[yearKey]);
  if (yearVal !== null) return yearVal;

  // Try ratio keys
  const ratioVal = input.ratios[canonicalKey];
  if (ratioVal !== null && ratioVal !== undefined && isFinite(ratioVal)) return ratioVal;

  return null;
}

// ---------------------------------------------------------------------------
// QoE adjustment extraction
// ---------------------------------------------------------------------------

function getAdjustmentsForKey(
  input: SpreadOutputInput,
  canonicalKey: string,
): SpreadAdjustment[] {
  if (!input.qoe_report) return [];

  const adjustments: SpreadAdjustment[] = [];
  const qoeKey = canonicalKey.toLowerCase();

  // Only apply QoE adjustments to EBITDA-related keys
  const ebitdaKeys = new Set([
    "ebitda", "cf_ebitda_adjusted", "cf_qoe_adjustment",
    "cf_owner_benefit_addbacks", "cf_ebitda_owner_adjusted",
  ]);
  if (!ebitdaKeys.has(qoeKey)) return [];

  for (const adj of input.qoe_report.adjustments) {
    const adjType = classificationToType(adj.classification);
    adjustments.push({
      label: adj.lineItem,
      amount: adj.direction === "add_back" ? adj.amount : -adj.amount,
      source: adj.source,
      type: adjType,
    });
  }

  return adjustments;
}

function classificationToType(classification: string): SpreadAdjustment["type"] {
  switch (classification) {
    case "non_recurring_income":
    case "non_recurring_expense":
      return "qoe";
    case "owner_benefit":
      return "owner_benefit";
    case "normalization":
      return "normalization";
    default:
      return "qoe";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}
