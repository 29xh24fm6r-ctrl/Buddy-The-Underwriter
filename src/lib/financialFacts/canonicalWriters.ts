/**
 * SPEC-FOUNDATION-V1-PR5I — Canonical Writer Registry
 *
 * Documentation-as-code: every canonical writer's role, contract, and
 * dependencies in one auditable surface. Governs under Build Principle #14.
 *
 * If you are adding a new canonical writer, register it here BEFORE
 * writing the implementation. If you are removing a writer marked
 * loadBearing: true, STOP — read the regression test and the spec first.
 */

export type WriterRole = "bootstrap" | "compute" | "propagate" | "persist_render";

export interface CanonicalWriterEntry {
  /** Module name, used for ledger meta.extractor populated by the writer. */
  name: string;
  /** Architectural role. */
  role: WriterRole;
  /** fact_keys this writer is contractually responsible for. */
  ownedFactKeys: string[];
  /** fact_keys this writer bootstraps for downstream consumers (i.e., is the only writer that can produce them in cold-start). */
  bootstrapsForDownstream: string[];
  /** What this writer reads to do its work. */
  reads: {
    factKeys?: string[];
    tables?: string[];
    spreadTypes?: string[];
  };
  /** Module names that must run before this writer in the canonical chain. */
  runsAfter: string[];
  /** Module names that must run after this writer in the canonical chain. */
  runsBefore: string[];
  /** Human-readable invariant. */
  invariant: string;
  /** If true, this writer is load-bearing — removing it breaks the chain. Do not delete. */
  loadBearing: boolean;
  /** Free-form notes for future engineers. */
  notes?: string;
}

export const CANONICAL_WRITERS: Record<string, CanonicalWriterEntry> = {
  runCashFlowAggregator: {
    name: "runCashFlowAggregator",
    role: "bootstrap",
    // SPEC-GLOBAL-DEBT-SERVICE-DENOMINATOR-1 (PR-519): the aggregator writes only
    // PROPOSED-loan figures. Total ANNUAL_DEBT_SERVICE + canonical DSCR (total/business
    // denominator) are owned SOLELY by computeTotalDebtService, which runs after.
    ownedFactKeys: [
      "ANNUAL_DEBT_SERVICE_PROPOSED",
      "PROPOSED_LOAN_COVERAGE",
      "CASH_FLOW_AVAILABLE",
      "EXCESS_CASH_FLOW",
    ],
    bootstrapsForDownstream: ["CASH_FLOW_AVAILABLE"],
    reads: {
      factKeys: ["EBITDA", "ORDINARY_BUSINESS_INCOME", "NET_INCOME"],
      tables: ["deal_structural_pricing"],
    },
    runsAfter: ["backfillCanonicalFactsFromSpreads"],
    runsBefore: ["computeTotalDebtService"],
    invariant:
      "On successful exit, CASH_FLOW_AVAILABLE fact exists for the deal IF at least one of EBITDA/OBI/NET_INCOME exists with a non-null value.",
    loadBearing: true,
    notes:
      "BOOTSTRAP-WRITER-DO-NOT-REMOVE. " +
      "The GCF spread template (globalCashFlow.ts) READS the canonical CASH_FLOW_AVAILABLE fact rather than computing it from raw inputs. " +
      "backfillCanonicalFactsFromSpreads reads the GCF spread's rendered_json. " +
      "Therefore on a fresh deal's first canonical chain run, only this writer can produce CASH_FLOW_AVAILABLE — without it, " +
      "backfill propagates null, computeTotalDebtService skips DSCR with MISSING_PREREQ_NOI, and the chain cannot recover. " +
      "On steady-state runs (CASH_FLOW_AVAILABLE already exists from a prior run), the role is technically redundant with backfill, " +
      "but the cold-start bootstrap role makes the writer load-bearing. " +
      "Also called from the classic-spread route as defense-in-depth (banker-initiated PDF generation path).",
  },

  backfillCanonicalFactsFromSpreads: {
    name: "backfillCanonicalFactsFromSpreads",
    role: "propagate",
    ownedFactKeys: [
      "CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE", "DSCR",
      "DSCR_STRESSED_300BPS", "EXCESS_CASH_FLOW",
      "NOI_TTM", "TOTAL_INCOME_TTM", "OPEX_TTM",
      "REVENUE", "COGS", "GROSS_PROFIT", "EBITDA", "NET_INCOME",
      "IN_PLACE_RENT_MO", "OCCUPANCY_PCT", "VACANCY_PCT",
      "TOTAL_ASSETS", "TOTAL_LIABILITIES", "NET_WORTH",
      "WORKING_CAPITAL", "CURRENT_RATIO", "DEBT_TO_EQUITY",
      "PERSONAL_TOTAL_INCOME",
      "PFS_TOTAL_ASSETS", "PFS_TOTAL_LIABILITIES", "PFS_NET_WORTH",
      "GCF_GLOBAL_CASH_FLOW", "GCF_DSCR",
    ],
    bootstrapsForDownstream: [],
    reads: {
      spreadTypes: [
        "GLOBAL_CASH_FLOW", "T12", "RENT_ROLL", "BALANCE_SHEET",
        "PERSONAL_INCOME", "PERSONAL_FINANCIAL_STATEMENT",
      ],
    },
    runsAfter: ["all spread renders"],
    runsBefore: ["runCashFlowAggregator"],
    invariant:
      "On exit, every fact written has fact_value_num != null. " +
      "Null-valued source data is SKIPPED (gated by BACKFILL_NULL_GATE_ENABLED flag, default true).",
    loadBearing: true,
    notes:
      "Propagates rendered spread values back into the canonical facts table so " +
      "downstream consumers (memo, snapshot, advisor) can read them without re-rendering spreads. " +
      "Note: does NOT bootstrap CASH_FLOW_AVAILABLE on cold-start deals because the GCF spread template " +
      "reads the fact rather than computes it — chicken-and-egg. See runCashFlowAggregator.notes.",
  },

  computeBusinessEbitdaFacts: {
    name: "computeBusinessEbitdaFacts",
    role: "compute",
    ownedFactKeys: ["EBITDA"],
    bootstrapsForDownstream: [],
    reads: {
      factKeys: [
        "ORDINARY_BUSINESS_INCOME", "INTEREST_EXPENSE", "DEPRECIATION",
        "AMORTIZATION", "SECTION_179_EXPENSE", "BONUS_DEPRECIATION",
        "NON_RECURRING_EXPENSE", "NON_RECURRING_INCOME", "GUARANTEED_PAYMENTS",
      ],
      tables: ["deal_entities", "deal_methodology_choices"],
    },
    runsAfter: ["backfillCanonicalFactsFromSpreads"],
    runsBefore: ["analyzeOfficerCompFacts", "runCashFlowAggregator"],
    invariant:
      "On exit, for each OPCO entity where ORDINARY_BUSINESS_INCOME is non-null, " +
      "an entity-scoped EBITDA fact is written via the slate-aware ebitdaEngine " +
      "with methodology provenance for ebitda_addback_stack. " +
      "When zero OPCO entities exist, no-ops cleanly (factsWritten=0).",
    loadBearing: false,
    notes:
      "SPEC-B4.1.2. Entity-scoped EBITDA facts are read by runCashFlowAggregator " +
      "when ncads_source='standard'. Property-context (RE) deals with no OPCO entities " +
      "fall back to the deal-scoped EBITDA fact written by backfill (NOI proxy path).",
  },

  analyzeOfficerCompFacts: {
    name: "analyzeOfficerCompFacts",
    role: "compute",
    ownedFactKeys: ["OFFICER_COMP_EXCESS_ADDBACK"],
    bootstrapsForDownstream: [],
    reads: {
      factKeys: ["OFFICER_COMPENSATION", "GROSS_RECEIPTS", "GUARANTEED_PAYMENTS"],
      tables: ["deal_entities", "deal_methodology_choices"],
    },
    runsAfter: ["computeBusinessEbitdaFacts"],
    runsBefore: ["runCashFlowAggregator"],
    invariant:
      "On exit, for each OPCO entity, OFFICER_COMP_EXCESS_ADDBACK is written (0 when " +
      "flag is NORMAL/LOW/INSUFFICIENT or variant is no_normalization). " +
      "Methodology provenance attached for the officer_comp axis.",
    loadBearing: false,
    notes:
      "SPEC-B4.1.2. The add-back fact is observational for memo/snapshot consumers " +
      "to display officer comp normalization in EBITDA waterfalls.",
  },

  computeCashFlowWaterfallFacts: {
    name: "computeCashFlowWaterfallFacts",
    role: "compute",
    // SPEC-CANONICAL-NCADS-WATERFALL-WIRING-1: institutional NCADS source. Writes CF_NCADS
    // and the canonical CASH_FLOW_AVAILABLE (high confidence) from the cash-flow waterfall
    // for the most recent COMPLETE fiscal year.
    ownedFactKeys: ["CF_NCADS", "CASH_FLOW_AVAILABLE"],
    bootstrapsForDownstream: ["CASH_FLOW_AVAILABLE"],
    reads: {
      factKeys: [
        "ORDINARY_BUSINESS_INCOME", "TAXABLE_INCOME", "NET_INCOME", "DEPRECIATION",
        "AMORTIZATION", "SECTION_179_EXPENSE", "BONUS_DEPRECIATION", "INTEREST_EXPENSE",
        "NON_RECURRING_INCOME", "NON_RECURRING_EXPENSE", "OFFICER_COMPENSATION",
        "GUARANTEED_PAYMENTS", "GROSS_RECEIPTS", "TOTAL_TAX", "M1_FEDERAL_TAX_BOOK",
        "MAINTENANCE_CAPEX", "SCH_C_NET_PROFIT",
      ],
      tables: ["deal_financial_facts", "deal_methodology_choices"],
    },
    runsAfter: ["computeBusinessEbitdaFacts", "analyzeOfficerCompFacts"],
    runsBefore: ["runCashFlowAggregator"],
    invariant:
      "When a complete fiscal-year period with an income base fact exists, CF_NCADS and " +
      "CASH_FLOW_AVAILABLE are written from the institutional waterfall (base + addbacks + " +
      "QoE + owner benefit − tax − capex) with full provenance. Interim periods are never " +
      "used. When no complete FY exists, nothing is written and a labeled diagnostic event " +
      "is emitted (runCashFlowAggregator's cold-start bootstrap then applies).",
    loadBearing: false,
    notes:
      "SPEC-CANONICAL-NCADS-WATERFALL-WIRING-1 Step 1. The canonical NCADS source; " +
      "runCashFlowAggregator prefers CF_NCADS and demotes its crude C-corp/tax-return " +
      "fallbacks to cold-start diagnostics. DSCR remains owned by computeTotalDebtService.",
  },

  computeTotalDebtService: {
    name: "computeTotalDebtService",
    role: "compute",
    ownedFactKeys: [
      "ANNUAL_DEBT_SERVICE_PROPOSED",
      "ANNUAL_DEBT_SERVICE_EXISTING",
      "ANNUAL_DEBT_SERVICE",
      "DSCR",
      "GCF_DSCR",
      "DSCR_STRESSED_300BPS",
    ],
    bootstrapsForDownstream: [],
    reads: {
      factKeys: ["CASH_FLOW_AVAILABLE", "GCF_GLOBAL_CASH_FLOW"],
      tables: ["deal_structural_pricing", "deal_existing_debt_schedule"],
    },
    runsAfter: ["runCashFlowAggregator"],
    runsBefore: ["persistGlobalCashFlow"],
    invariant:
      "On exit with proposed > 0: ANNUAL_DEBT_SERVICE_PROPOSED, ANNUAL_DEBT_SERVICE, ANNUAL_DEBT_SERVICE_EXISTING " +
      "(if existing debt rows present) all exist with non-null values. " +
      "DSCR exists iff CASH_FLOW_AVAILABLE was non-null at read time (graceful degradation via MISSING_PREREQ_NOI otherwise).",
    loadBearing: true,
    notes:
      "Aggregates proposed (from deal_structural_pricing) + existing (from deal_existing_debt_schedule) into total ADS. " +
      "Computes DSCR using the canonical CASH_FLOW_AVAILABLE fact (which the aggregator wrote upstream). " +
      "On null CASH_FLOW_AVAILABLE: emits MISSING_PREREQ_NOI warning via writeEvent, skips DSCR, still writes ADS facts. " +
      "Writes carry provenance.extractor: 'computeTotalDebtService:v1' (added in PR5i).",
  },

  persistGlobalCashFlow: {
    name: "persistGlobalCashFlow",
    role: "compute",
    ownedFactKeys: ["GCF_GLOBAL_CASH_FLOW", "GCF_DSCR", "GLOBAL_CASH_FLOW"],
    bootstrapsForDownstream: [],
    reads: {
      factKeys: [
        "NOI_TTM", "EBITDA", "CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE",
        "ANNUAL_DEBT_SERVICE_PROPOSED", "ANNUAL_DEBT_SERVICE_EXISTING",
        // SPEC-GCF-SOURCE-OF-TRUTH-1: personal income now derives from the GCF
        // template's K-1-excluded component build-up (WAGES_W2, SCH_E_RENTAL_TOTAL,
        // etc. — see gcfPersonalIncome.ts), NOT the AGI aggregate TOTAL_PERSONAL_INCOME.
        "WAGES_W2", "SCH_E_RENTAL_TOTAL", "SCH_E_NET", "TAXABLE_INTEREST",
        "ORDINARY_DIVIDENDS", "SOCIAL_SECURITY", "IRA_DISTRIBUTIONS",
        "PENSION_ANNUITY", "SCHED_C_NET",
        "PFS_ANNUAL_DEBT_SERVICE", "PFS_LIVING_EXPENSES",
        "DEPRECIATION",
      ],
      tables: ["deal_entities"],
    },
    runsAfter: ["computeTotalDebtService"],
    runsBefore: ["second GCF render (PR5g)"],
    invariant:
      "On exit with at least one operating entity AND non-null entity netIncome: " +
      "GCF_GLOBAL_CASH_FLOW, GCF_DSCR, GLOBAL_CASH_FLOW facts all exist with non-null values. " +
      "Otherwise: facts may be null (preserved for legacy compat).",
    loadBearing: true,
    notes:
      "Calls the pure computeGlobalCashFlow() function with entity + sponsor inputs from the DB. " +
      "Writes GLOBAL_CASH_FLOW (legacy key) for backward compat in addition to GCF_GLOBAL_CASH_FLOW. " +
      "Entity netIncome fallback chain: NOI_TTM → EBITDA → CASH_FLOW_AVAILABLE — soft dependency on aggregator's bootstrap.",
  },

  persistGcfComputedFacts: {
    name: "persistGcfComputedFacts",
    role: "persist_render",
    ownedFactKeys: ["GCF_GLOBAL_CASH_FLOW", "GCF_DSCR", "GCF_CASH_AVAILABLE"],
    bootstrapsForDownstream: [],
    reads: {
      spreadTypes: ["GLOBAL_CASH_FLOW"],
    },
    runsAfter: ["GLOBAL_CASH_FLOW renderSpread"],
    runsBefore: ["next canonical chain step (within spreadsProcessor)"],
    invariant:
      "On exit, for each PERSIST_KEY whose rendered row has a non-null numeric value: " +
      "the corresponding canonical fact exists with that value.",
    loadBearing: true,
    notes:
      "Fire-and-forget from renderSpread. Persists rendered GCF metrics back to canonical facts " +
      "so Standard spread, snapshot, and memo can reference them without re-computing. " +
      "Overlap with persistGlobalCashFlow on GCF_GLOBAL_CASH_FLOW and GCF_DSCR is intentional: " +
      "this writer captures render-time computed values; persistGlobalCashFlow captures pure-function computed values. " +
      "Last-writer-wins on shared keys; both writers run within the same canonical chain.",
  },
};
