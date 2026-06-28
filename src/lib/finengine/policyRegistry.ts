/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 1
 *
 * Versioned three-layer policy registry — the SINGLE source of truth for every
 * credit-policy axis (NG4: no DSCR floor / leverage limit / advance rate /
 * occupancy threshold / stress parameter hardcoded in computation code).
 *
 * Three layers, resolved by precedence with a conservative clamp:
 *   1. regulatoryFloor       — the regulator's hard line (SBA SOP, OCC, FDIC).
 *   2. institutionalOverlay  — the bank's stricter standard (above the floor).
 *   3. tenantOverride        — a per-tenant/per-deal value.
 *
 * Resolution: effective = first defined of [tenantOverride, institutionalOverlay,
 * regulatoryFloor], then clamped so it can NEVER be weaker than the regulatory
 * floor in the conservative direction (a 'floor' axis may be raised but not
 * lowered below the regulator; a 'cap' axis may be tightened but not loosened).
 *
 * Every axis carries `version`, `citation`, and `asOf`. Pure module — the
 * tenant-override layer is supplied by the caller (wired to `bank_policy_rules`
 * in a later phase); Phase 1 resolves from seeded floors/overlays + an optional
 * `overrides` map.
 */

import type {
  ResolvedPolicy,
  PolicyContext,
  PolicyDirection,
} from "@/lib/finengine/contracts";

export const POLICY_REGISTRY_VERSION = "1.0.0" as const;

type PolicyAxisDef = {
  axis: string;
  direction: PolicyDirection;
  regulatoryFloor?: number | null;
  institutionalOverlay?: number | null;
  citation: string;
  asOf: string;
  /** Optional per-product floor/overlay overrides (e.g. SBA small vs standard). */
  byProduct?: Record<string, { regulatoryFloor?: number | null; institutionalOverlay?: number | null; citation?: string }>;
  notes?: string;
};

/**
 * Seeded policy axes. Values cite their governing authority and effective date.
 * Leverage is modeled as an OVERLAY not a regulatory constant because the OCC /
 * FDIC withdrew the leveraged-lending guidance (Dec 2025) — there is no longer a
 * regulatory floor, only the institution's risk appetite.
 */
const AXES: Record<string, PolicyAxisDef> = {
  dscr_floor: {
    axis: "dscr_floor",
    direction: "floor",
    regulatoryFloor: 1.1, // SBA Small default
    institutionalOverlay: 1.2,
    citation: "SBA SOP 50 10 8 §B Credit Standards; institutional overlay (POLICY_DEFAULTS.dscr_minimum)",
    asOf: "2025-06-01",
    byProduct: {
      SBA_7A_SMALL: { regulatoryFloor: 1.1, institutionalOverlay: 1.2, citation: "SOP 50 10 8 §B Ch.1 — Small 7(a) ≥ 1.10x" },
      SBA_7A_STANDARD: { regulatoryFloor: 1.15, institutionalOverlay: 1.25, citation: "SOP 50 10 8 §B Ch.1 — Standard 7(a) ≥ 1.15x" },
      SBA_504: { regulatoryFloor: 1.15, institutionalOverlay: 1.25, citation: "SOP 50 10 8 §B — 504 ≥ 1.15x" },
      CI_TERM: { regulatoryFloor: null, institutionalOverlay: 1.25, citation: "Institutional C&I DSCR overlay (POLICY_DEFAULTS.dscr_minimum 1.25)" },
    },
  },
  fccr_floor: {
    axis: "fccr_floor",
    direction: "floor",
    regulatoryFloor: null,
    institutionalOverlay: 1.15,
    citation: "Institutional fixed-charge coverage overlay (POLICY_DEFAULTS.fccr_minimum)",
    asOf: "2025-06-01",
  },
  // SPEC-FINENGINE-FULL-SPREAD-1 — balance-sheet diagnostic axes (conservative defaults).
  current_ratio_min: {
    axis: "current_ratio_min",
    direction: "floor",
    regulatoryFloor: null,
    institutionalOverlay: 1.0,
    citation: "Institutional liquidity overlay (current ratio ≥ 1.0; industry-benchmarked higher for manufacturers)",
    asOf: "2025-06-01",
  },
  quick_ratio_min: {
    axis: "quick_ratio_min",
    direction: "floor",
    regulatoryFloor: null,
    institutionalOverlay: 1.0,
    citation: "Institutional quick-ratio overlay (acid test ≥ 1.0)",
    asOf: "2025-06-01",
  },
  debt_to_equity_max: {
    axis: "debt_to_equity_max",
    direction: "cap",
    regulatoryFloor: null,
    institutionalOverlay: 3.0,
    citation: "Institutional balance-sheet leverage overlay (total liabilities ÷ equity ≤ 3.0x for SMEs; industry-relative)",
    asOf: "2025-06-01",
  },
  debt_to_worth_max: {
    axis: "debt_to_worth_max",
    direction: "cap",
    regulatoryFloor: null,
    institutionalOverlay: 4.0,
    citation: "Institutional debt-to-worth overlay (total liabilities ÷ net worth ≤ 4.0x; tighter on TNW basis)",
    asOf: "2025-06-01",
  },
  debt_to_assets_max: {
    axis: "debt_to_assets_max",
    direction: "cap",
    regulatoryFloor: null,
    institutionalOverlay: 0.8,
    citation: "Institutional funded-debt-to-assets overlay (≤ 0.80 for SMEs)",
    asOf: "2025-06-01",
  },
  debt_to_etnw_max: {
    axis: "debt_to_etnw_max",
    direction: "cap",
    regulatoryFloor: null,
    institutionalOverlay: 1.3,
    citation: "Institutional debt-to-effective-TNW overlay ((total liabilities − sub debt) ÷ ETNW ≤ 1.0–1.30x)",
    asOf: "2025-06-01",
  },
  // Altman distress-model zone boundaries (academic model constants, registry-sourced
  // so an institution may override; SPEC-FINENGINE-FULL-SPREAD-1 §8).
  altman_zprime_safe: { axis: "altman_zprime_safe", direction: "floor", regulatoryFloor: null, institutionalOverlay: 2.9, citation: "Altman Z′ private-manufacturing safe-zone boundary (>2.90)", asOf: "2000-01-01" },
  altman_zprime_distress: { axis: "altman_zprime_distress", direction: "floor", regulatoryFloor: null, institutionalOverlay: 1.23, citation: "Altman Z′ private-manufacturing distress boundary (<1.23)", asOf: "2000-01-01" },
  altman_zdoubleprime_safe: { axis: "altman_zdoubleprime_safe", direction: "floor", regulatoryFloor: null, institutionalOverlay: 2.6, citation: "Altman Z″ private non-manufacturing safe-zone boundary (>2.60)", asOf: "2000-01-01" },
  altman_zdoubleprime_distress: { axis: "altman_zdoubleprime_distress", direction: "floor", regulatoryFloor: null, institutionalOverlay: 1.1, citation: "Altman Z″ private non-manufacturing distress boundary (<1.10)", asOf: "2000-01-01" },
  // Dual risk-rating thresholds (PD obligor grade + LGD facility severity) —
  // registry-sourced so an institution may tighten its grading without a code
  // change (NG4). DSCR grade factors are multipliers on the resolved dscr_floor.
  pd_dscr_grade2_factor: { axis: "pd_dscr_grade2_factor", direction: "floor", regulatoryFloor: null, institutionalOverlay: 1.5, citation: "Obligor grade-2 DSCR cushion = 1.50× the DSCR floor (institutional grading overlay)", asOf: "2025-06-01" },
  pd_dscr_grade3_factor: { axis: "pd_dscr_grade3_factor", direction: "floor", regulatoryFloor: null, institutionalOverlay: 1.2, citation: "Obligor grade-3 DSCR cushion = 1.20× the DSCR floor (institutional grading overlay)", asOf: "2025-06-01" },
  pd_dscr_special_mention_min: { axis: "pd_dscr_special_mention_min", direction: "floor", regulatoryFloor: null, institutionalOverlay: 1.0, citation: "Below the policy floor but ≥ 1.00× DSCR → special-mention watch grade", asOf: "2025-06-01" },
  pd_dscr_substandard_min: { axis: "pd_dscr_substandard_min", direction: "floor", regulatoryFloor: null, institutionalOverlay: 0.9, citation: "DSCR ≥ 0.90× but < 1.00× → substandard (cannot fully service debt)", asOf: "2025-06-01" },
  lgd_coverage_strong: { axis: "lgd_coverage_strong", direction: "floor", regulatoryFloor: null, institutionalOverlay: 1.25, citation: "Collateral coverage ≥ 1.25× → low LGD band (institutional LGD grid)", asOf: "2025-06-01" },
  lgd_coverage_adequate: { axis: "lgd_coverage_adequate", direction: "floor", regulatoryFloor: null, institutionalOverlay: 1.0, citation: "Collateral coverage ≥ 1.00× → adequate LGD band", asOf: "2025-06-01" },
  lgd_coverage_weak: { axis: "lgd_coverage_weak", direction: "floor", regulatoryFloor: null, institutionalOverlay: 0.75, citation: "Collateral coverage ≥ 0.75× → elevated LGD band; below → severe", asOf: "2025-06-01" },
  leverage_max: {
    axis: "leverage_max",
    direction: "cap",
    // No regulatory cap since OCC/FDIC withdrew leveraged-lending guidance (Dec 2025).
    regulatoryFloor: null,
    institutionalOverlay: 4.5, // policy; 5.0 critical
    citation: "Institutional Debt/EBITDA overlay (POLICY_DEFAULTS.debt_ebitda_maximum 4.5x; 5.0x critical). OCC/FDIC leveraged-lending guidance withdrawn Dec 2025 — overlay, not regulatory.",
    asOf: "2025-12-01",
    byProduct: {
      CI_TERM: { institutionalOverlay: 4.5 },
    },
  },
  ltv_max: {
    axis: "ltv_max",
    direction: "cap",
    regulatoryFloor: null,
    institutionalOverlay: 0.75,
    citation: "Institutional LTV overlay (POLICY_DEFAULTS.ltv_maximum 0.75). Interagency CRE supervisory LTV limits inform the floor.",
    asOf: "2025-06-01",
  },
  occupancy_min: {
    axis: "occupancy_min",
    direction: "floor",
    regulatoryFloor: 0.51, // SBA 504 owner-occupancy
    institutionalOverlay: null,
    citation: "SBA SOP 50 10 8 — 504 owner-occupancy ≥ 51% existing building",
    asOf: "2025-06-01",
    byProduct: {
      SBA_504: { regulatoryFloor: 0.51, citation: "SOP 50 10 8 — 504 existing building ≥ 51%" },
      SBA_504_NEW_CONSTRUCTION: { regulatoryFloor: 0.6, citation: "SOP 50 10 8 — 504 new construction ≥ 60%" },
    },
  },
  equity_injection_min: {
    axis: "equity_injection_min",
    direction: "floor",
    regulatoryFloor: 0.1,
    institutionalOverlay: null,
    citation: "SBA SOP 50 10 8 §B Ch.2 — ≥ 10% equity of total project cost (new business / change of ownership)",
    asOf: "2025-06-01",
  },
  advance_rate_ar: {
    axis: "advance_rate_ar",
    direction: "cap",
    regulatoryFloor: null,
    institutionalOverlay: 0.8, // typical ABL eligible-AR advance
    citation: "OCC ABL Handbook / institutional advance-rate overlay (eligible AR ≤ 80%)",
    asOf: "2025-06-01",
  },
  advance_rate_inv: {
    axis: "advance_rate_inv",
    direction: "cap",
    regulatoryFloor: null,
    institutionalOverlay: 0.5, // typical inventory advance at NOLV
    citation: "OCC ABL Handbook / institutional inventory advance overlay (≤ 50% of NOLV)",
    asOf: "2025-06-01",
  },
  // SPEC-FINENGINE-PRODUCT-DEPTH-AND-SIZING-1 — equipment finance sizing axes.
  advance_rate_equipment_new: {
    axis: "advance_rate_equipment_new",
    direction: "cap",
    regulatoryFloor: null,
    institutionalOverlay: 0.8, // conservative; new equipment commonly 80–90% of invoice cost
    citation: "Institutional equipment-finance overlay (new equipment advance ≤ 80% of cost; 80–90% typical)",
    asOf: "2026-06-28",
  },
  advance_rate_equipment_used_nolv: {
    axis: "advance_rate_equipment_used_nolv",
    direction: "cap",
    regulatoryFloor: null,
    institutionalOverlay: 0.8, // used equipment advanced against net orderly liquidation value
    citation: "Institutional equipment-finance overlay (used equipment advance ≤ 80% of NOLV)",
    asOf: "2026-06-28",
  },
  term_to_useful_life_max: {
    axis: "term_to_useful_life_max",
    direction: "cap",
    regulatoryFloor: null,
    institutionalOverlay: 0.8, // loan term should not outrun the asset's economic life
    citation: "Institutional structural overlay (loan term ≤ 80% of equipment useful life; self-liquidating collateral)",
    asOf: "2026-06-28",
  },
  // Stress parameters (multi-valued — exposed via getStressParams()).
  stress_rate_bps: {
    axis: "stress_rate_bps",
    direction: "floor",
    regulatoryFloor: 300,
    institutionalOverlay: null,
    citation: "Rate shock +300bps (computeTotalDebtService stressedRate = structRate + 3.0)",
    asOf: "2025-06-01",
  },
  stress_revenue_compression: {
    axis: "stress_revenue_compression",
    direction: "floor",
    regulatoryFloor: 0.15, // Stress C binding revenue compression
    institutionalOverlay: null,
    citation: "Stress C binding gate: +300bps + 15% revenue compression, min 1.00x DSCR",
    asOf: "2025-06-01",
  },
  stress_dscr_min: {
    axis: "stress_dscr_min",
    direction: "floor",
    regulatoryFloor: 1.0,
    institutionalOverlay: null,
    citation: "Stress C binding gate minimum 1.00x on fully-amortizing debt service",
    asOf: "2025-06-01",
  },
};

/** Pick the floor/overlay for an axis, honoring product-specific values. */
function layerFor(def: PolicyAxisDef, productId?: string | null): { floor: number | null; overlay: number | null; citation: string } {
  const p = productId ? def.byProduct?.[productId] : undefined;
  const floor = p?.regulatoryFloor !== undefined ? p.regulatoryFloor : def.regulatoryFloor ?? null;
  const overlay = p?.institutionalOverlay !== undefined ? p.institutionalOverlay : def.institutionalOverlay ?? null;
  const citation = p?.citation ?? def.citation;
  return { floor: floor ?? null, overlay: overlay ?? null, citation };
}

/**
 * Resolve a policy axis to its effective value. Precedence: tenantOverride >
 * institutionalOverlay > regulatoryFloor; then conservative clamp against the
 * regulatory floor (a floor cannot be lowered below / a cap cannot be raised
 * above the regulator).
 */
export function resolvePolicy(axis: string, ctx?: PolicyContext): ResolvedPolicy {
  const def = AXES[axis];
  if (!def) {
    throw new Error(`[policyRegistry] unknown policy axis: ${axis}`);
  }
  const { floor, overlay, citation } = layerFor(def, ctx?.productId);
  const tenantOverride = ctx?.overrides?.[axis] ?? null;

  // Precedence: first defined wins.
  let effective: number | null =
    tenantOverride != null ? tenantOverride : overlay != null ? overlay : floor;

  // Conservative clamp: never weaker than the regulatory floor.
  if (effective != null && floor != null) {
    effective = def.direction === "floor" ? Math.max(effective, floor) : Math.min(effective, floor);
  }

  return {
    axis,
    direction: def.direction,
    regulatoryFloor: floor,
    institutionalOverlay: overlay,
    tenantOverride,
    effective,
    version: POLICY_REGISTRY_VERSION,
    citation,
    asOf: def.asOf,
  };
}

/** List every seeded axis id (used by guards/tests for completeness). */
export function listPolicyAxes(): string[] {
  return Object.keys(AXES);
}

/** Convenience accessor for the stress parameter bundle. */
export function getStressParams(ctx?: PolicyContext): {
  rateBps: number | null;
  revenueCompression: number | null;
  dscrMin: number | null;
} {
  return {
    rateBps: resolvePolicy("stress_rate_bps", ctx).effective,
    revenueCompression: resolvePolicy("stress_revenue_compression", ctx).effective,
    dscrMin: resolvePolicy("stress_dscr_min", ctx).effective,
  };
}
