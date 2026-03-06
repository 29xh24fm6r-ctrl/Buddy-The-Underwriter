/**
 * Story Panel Generator — Panel 5
 *
 * Generates the credit story: risks, strengths, resolution, covenants.
 * Pure function — no DB, no server imports.
 */

import type { SpreadOutputInput, StoryPanel, CovenantSuggestion } from "./types";
import type { ComposedNarratives } from "./narrativeComposer";
import { getSpreadTemplate } from "./spreadTemplateRegistry";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function generateStoryPanel(
  input: SpreadOutputInput,
  narratives: ComposedNarratives,
): StoryPanel {
  return {
    top_risks: narratives.top_risks,
    top_strengths: narratives.top_strengths,
    resolution_narrative: narratives.resolution_narrative,
    covenant_suggestions: buildCovenantSuggestions(input),
    final_narrative: narratives.final_narrative,
  };
}

// ---------------------------------------------------------------------------
// Covenant suggestions
// ---------------------------------------------------------------------------

function buildCovenantSuggestions(input: SpreadOutputInput): CovenantSuggestion[] {
  const template = getSpreadTemplate(input.deal_type);
  const policy = input.bank_policy ?? {
    dscr_minimum: 1.25,
    fccr_minimum: 1.15,
    current_ratio_minimum: 1.10,
    ltv_maximum: 0.75,
    ltc_maximum: 0.80,
    debt_ebitda_maximum: 4.5,
    post_close_liquidity_pct: 0.10,
  };
  const suggestions: CovenantSuggestion[] = [];

  // DSCR covenant — always suggest if within 20% of policy minimum
  const dscr = getNum(input.ratios, "DSCR", "ratio_dscr_final");
  if (dscr !== null && dscr < policy.dscr_minimum * 1.20) {
    const threshold = Math.max(1.0, policy.dscr_minimum - 0.05);
    suggestions.push({
      covenant_type: "Annual DSCR test",
      description: `DSCR >= ${threshold.toFixed(2)}x tested annually`,
      rationale: `Current DSCR of ${dscr.toFixed(2)}x is within 20% of the ${policy.dscr_minimum}x policy minimum — annual monitoring provides early warning of coverage deterioration.`,
      canonical_key: "DSCR",
      threshold,
      frequency: "annually",
    });
  }

  // Current ratio covenant — suggest if within 15% of policy minimum
  const currentRatio = getNum(input.ratios, "CURRENT_RATIO", "ratio_current");
  if (currentRatio !== null && currentRatio < policy.current_ratio_minimum * 1.15) {
    const threshold = Math.max(0.8, currentRatio - 0.10);
    suggestions.push({
      covenant_type: "Quarterly current ratio test",
      description: `Current ratio >= ${threshold.toFixed(2)}x tested quarterly`,
      rationale: `Current ratio of ${currentRatio.toFixed(2)}x is near the ${policy.current_ratio_minimum}x policy minimum — quarterly monitoring ensures liquidity is maintained.`,
      canonical_key: "CURRENT_RATIO",
      threshold,
      frequency: "quarterly",
    });
  }

  // C&I with elevated DSO — borrowing base certificate
  const dso = getNum(input.ratios, "DSO", "ratio_dso");
  if (
    (input.deal_type === "c_and_i" || input.deal_type === "working_capital") &&
    dso !== null &&
    dso > 60
  ) {
    suggestions.push({
      covenant_type: "Monthly borrowing base certificate",
      description: "Borrowing base certificate (AR + inventory) delivered monthly",
      rationale: `DSO of ${Math.round(dso)} days indicates extended collection cycles — monthly borrowing base monitoring protects collateral coverage.`,
      canonical_key: "DSO",
      threshold: dso,
      frequency: "monthly",
    });
  }

  // CRE — minimum occupancy covenant
  const occupancy = getNum(input.ratios, "cre_occupancy_pct");
  if (input.deal_type.startsWith("cre_") && occupancy !== null) {
    const threshold = Math.max(0.70, occupancy - 0.10);
    suggestions.push({
      covenant_type: "Minimum occupancy requirement",
      description: `Maintain minimum ${(threshold * 100).toFixed(0)}% occupancy rate`,
      rationale: `Current occupancy of ${(occupancy * 100).toFixed(0)}% — a ${(threshold * 100).toFixed(0)}% floor provides early warning of deterioration while allowing normal lease turnover.`,
      canonical_key: "cre_occupancy_pct",
      threshold,
      frequency: "quarterly",
    });
  }

  // Professional practice — key-man life insurance
  const providerConc = getNum(input.ratios, "ratio_revenue_per_provider");
  const largestProvider = toNum(input.canonical_facts["largest_provider_revenue_pct"]);
  if (
    input.deal_type === "professional_practice" &&
    (largestProvider !== null && largestProvider > 0.80)
  ) {
    suggestions.push({
      covenant_type: "Key-man life insurance assignment",
      description: "Assignment of key-man life insurance policy covering principal provider",
      rationale: `Largest provider generates ${(largestProvider * 100).toFixed(0)}% of revenue — key-man insurance mitigates catastrophic revenue loss from departure or incapacity.`,
      canonical_key: "ratio_revenue_per_provider",
      threshold: 0,
      frequency: "annually",
    });
  }

  // Add template-based defaults that weren't already covered
  for (const tc of template.covenant_templates) {
    const alreadyCovered = suggestions.some((s) => s.canonical_key === tc.canonical_key);
    if (!alreadyCovered) {
      suggestions.push({
        covenant_type: tc.covenant_type,
        description: tc.description,
        rationale: `Standard covenant for ${input.deal_type.replace(/_/g, " ")} deal type.`,
        canonical_key: tc.canonical_key,
        threshold: 0,
        frequency: tc.frequency,
      });
    }
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNum(ratios: Record<string, number | null>, ...keys: string[]): number | null {
  for (const key of keys) {
    const val = ratios[key];
    if (val !== null && val !== undefined && isFinite(val)) return val;
  }
  return null;
}

function toNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}
