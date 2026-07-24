/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 1
 *
 * Frozen canonical contracts for the unified credit engine. These interfaces
 * are the stable seams every later phase implements against:
 *   - CertifiedFact      — a number with full lineage (Phase 0 provenance).
 *   - CashFlowMethod     — one interface, many strategies (Phase 2).
 *   - EntityNode         — borrower/affiliate/guarantor graph node (Phase 3).
 *   - MetricResult       — an explainable computed metric (Phase 4).
 *   - ProductProfile     — config-over-core per product (Phase 5).
 *   - ResolvedPolicy     — a registry-resolved policy axis (this phase).
 *
 * Adapted to the REAL repo types (not the spec's reference TS): provenance is
 * the existing `FinancialFactProvenance` extended with Phase 0 normalized fields
 * via `StampedProvenance`; owner types mirror `deal_financial_facts.owner_type`.
 *
 * Pure type module — no runtime, no DB.
 */

import type { StampedProvenance, SourceQualityRank } from "@/lib/finengine/provenance";

// ---------------------------------------------------------------------------
// Method strategy identity
// ---------------------------------------------------------------------------

export type MethodId = "UCA" | "ADJ_EBITDA" | "SDE" | "TRADITIONAL" | "CRE_NOI" | "GLOBAL";

// ---------------------------------------------------------------------------
// Owner / entity identity (mirrors deal_financial_facts.owner_type)
// ---------------------------------------------------------------------------

export type OwnerType =
  | "DEAL"
  | "borrower"
  | "opco"
  | "affiliate"
  | "guarantor"
  | "spouse"
  | "related_entity";

export type EntityForm = "C_CORP" | "S_CORP" | "PARTNERSHIP" | "SOLE_PROP" | "INDIVIDUAL" | "UNKNOWN";

/** A node in the borrower/affiliate/guarantor graph (fully realized Phase 3). */
export type EntityNode = {
  id: string;
  ownerType: OwnerType;
  displayName: string; // NEVER deals.name/borrower_name — Samaritus leak guard (G5)
  form: EntityForm;
  /** Ownership edges: nodeId -> ownership fraction (0..1). */
  ownership?: Record<string, number>;
  isPrimaryOperating?: boolean;
  isGuarantor?: boolean;
};

// ---------------------------------------------------------------------------
// Certified fact — every number carries full lineage
// ---------------------------------------------------------------------------

export type CertifiedFact = {
  dealId: string;
  factKey: string; // registry-validated (Phase 1 factKeyRegistry)
  value: number | null;
  ownerType: OwnerType;
  ownerEntityId?: string | null;
  fiscalPeriodEnd: string; // 'YYYY-MM-DD'; sentinel '1900-01-01' for TTM/aggregate
  provenance: StampedProvenance; // Phase 0 normalized provenance
  sourceQualityRank?: SourceQualityRank; // §2.3 (mirrors provenance.source_quality_rank)
  reconciliation?: {
    status: "unique" | "superseded" | "conflict" | "reconciled";
    against?: string[];
  };
  isSuperseded: boolean;
  auditExplanation: string; // human-readable why-this-number
};

// ---------------------------------------------------------------------------
// Method strategy — one interface, many implementations (Phase 2+)
// ---------------------------------------------------------------------------

/** Normalized spread inputs handed to a method strategy. Pure data. */
export type SpreadInputs = {
  /** Flat fact map for the entity/period under analysis: factKey -> value. */
  facts: Record<string, number | null>;
  entityForm: EntityForm;
  /** IRS form type, e.g. 'FORM_1120' | 'FORM_1120S' | 'FORM_1065' | 'FORM_1040'. */
  formType?: string;
  fiscalPeriodEnd?: string;
};

/** A single line in a method's add-back / adjustment ledger. */
export type AdjustmentLine = {
  key: string;
  label: string;
  amount: number;
  category: "ADD_BACK" | "DEDUCTION" | "NORMALIZATION";
  docRef?: string;
  recurring: boolean;
  /** 0..1 — how defensible the adjustment is to an examiner. */
  defensibility: number;
  notes?: string;
};

export type CashFlowResult = {
  method: MethodId;
  /** The headline cash-flow figure this method produces. */
  cashFlowAvailable: number | null;
  base: { key: string; label: string; value: number | null };
  adjustments: AdjustmentLine[];
  explanation: string;
  warnings: string[];
};

export interface CashFlowMethod {
  id: MethodId;
  /** Whether this method applies to a given profile + entity. */
  appliesTo(profile: ProductProfile, entity: EntityNode): boolean;
  /** PURE — deterministic, no DB. */
  compute(inputs: SpreadInputs, policy: PolicyResolver): CashFlowResult;
}

// ---------------------------------------------------------------------------
// Policy registry (this phase)
// ---------------------------------------------------------------------------

/** Direction of a policy axis — a minimum threshold vs. a maximum cap. */
export type PolicyDirection = "floor" | "cap";

export type ResolvedPolicy = {
  axis: string; // 'dscr_floor' | 'leverage_max' | 'advance_rate_ar' | ...
  direction: PolicyDirection;
  regulatoryFloor?: number | null;
  institutionalOverlay?: number | null;
  tenantOverride?: number | null;
  /** Resolved value actually used (precedence + conservative clamp). */
  effective: number | null;
  version: string;
  citation: string;
  asOf: string; // ISO date the policy version took effect
};

/** Context for resolving a policy axis (tenant + product). */
export type PolicyContext = {
  bankId?: string | null;
  productId?: string | null;
  /**
   * SBA SOP 50 10 8 applies a stricter projected-DSCR standard to businesses
   * under 24 months old (§B Ch.1) — a deal characteristic, same category as
   * productId, not a discretionary tenant override. Only axes that define a
   * `newBusiness` variant (currently dscr_floor) read this; every other axis
   * ignores it, so passing it is always safe even when irrelevant.
   */
  isNewBusiness?: boolean;
  /** Explicit per-deal/tenant overrides keyed by axis. */
  overrides?: Record<string, number>;
};

/** A function that resolves a policy axis to its effective value. */
export type PolicyResolver = (axis: string, ctx?: PolicyContext) => ResolvedPolicy;

// ---------------------------------------------------------------------------
// Product profile — config, NOT an engine (Phase 5)
// ---------------------------------------------------------------------------

export type RepaymentSource =
  | "business_cf"
  | "collateral_conversion"
  | "property_noi"
  | "asset_resale"
  | "debtor_payment"
  | "forward_sales";

export type SizingConstraintId =
  | "DSCR"
  | "LTV"
  | "DEBT_YIELD"
  | "BORROWING_BASE"
  | "CAPLINE_RULE"
  | "SBA_PROGRAM_CAP"
  | "OCCUPANCY"
  | "EQUITY_INJECTION"
  | "MOST_RESTRICTIVE_OF";

export type CollateralModelId =
  | "NONE"
  | "CRE"
  | "AR_INVENTORY"
  | "EQUIPMENT"
  | "BLANKET_UCC"
  | "SBA_504_STACK";

export type ProductProfile = {
  productId: string; // 'SBA_7A_STANDARD' | 'SBA_504' | 'CI_TERM' | 'ABL_REVOLVER' | ...
  label: string;
  repaymentSourceHierarchy: RepaymentSource[];
  eligibleMethods: MethodId[];
  sizingConstraints: SizingConstraintId[];
  collateralModel: CollateralModelId;
  policyOverlayId: string; // resolves in the registry
};

// ---------------------------------------------------------------------------
// Metric result — explainable computed metric (Phase 4)
// ---------------------------------------------------------------------------

export type MetricResult = {
  metric: string; // 'DSCR' | 'GCF_DSCR' | 'FCCR' | 'LEVERAGE_TOTAL' | 'DEBT_YIELD' | ...
  value: number | null;
  method?: MethodId;
  inputs: Record<string, number>; // every input, for explainability
  policyApplied?: ResolvedPolicy;
  passesFloor?: boolean;
  explanation: string;
};
