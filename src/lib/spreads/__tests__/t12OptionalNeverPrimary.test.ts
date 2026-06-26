import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  OPTIONAL_SPREAD_TYPES,
  isOptionalSpreadType,
  filterOptionalSpreadsForDefaultRecompute,
} from "@/lib/spreads/t12Eligibility";
import { getBusinessSpreadTypesForDealContext } from "@/lib/spreads/businessSpreadContext";
import { ALL_SPREAD_TYPES, type SpreadType } from "@/lib/financialSpreads/types";
import { evaluateGcfPrerequisites, type GcfFactRow } from "@/lib/financialFacts/canonicalGcfCore";
import { evaluateMemoInputReadiness } from "@/lib/creditMemo/inputs/evaluateMemoInputReadiness";
import { getBlockerFixAction } from "@/buddy/lifecycle/nextAction";
import {
  computeReadinessAndBlockers,
  type SpreadStats,
} from "@/lib/documentTruth/computeReadinessAndBlockers";
import type { RequiredFinancialFacts } from "@/lib/creditMemo/inputs/types";

/**
 * SPEC-T12-OPTIONAL-NEVER-PRIMARY-1 — system-wide regression guard.
 *
 * T12 (trailing-twelve operating statement) is OPTIONAL / nice-to-have. It must
 * never act as a primary prerequisite, blocker, next action, readiness
 * dependency, analysis-status dependency, or required/default business spread.
 * Omnicare's T12 row was orphaned/error (ORPHANED_BY_FAILED_ORCHESTRATION) while
 * BALANCE_SHEET / PERSONAL_INCOME / PERSONAL_FINANCIAL_STATEMENT / STANDARD were
 * ready and CASH_FLOW_AVAILABLE was present — that orphan must not affect state.
 */

const root = process.cwd();
function read(rel: string): string {
  return fs.readFileSync(path.resolve(root, rel), "utf8");
}

function fact(fact_key: string, owner_type = "DEAL", owner_entity_id?: string): GcfFactRow {
  return { fact_key, fact_value_num: 1, owner_type, owner_entity_id, is_superseded: false };
}

// Omnicare-shaped facts: all GCF prerequisites satisfied via canonical facts.
function readyPrereqFacts(): GcfFactRow[] {
  return [
    fact("CASH_FLOW_AVAILABLE"),
    fact("ANNUAL_DEBT_SERVICE"),
    fact("WAGES_W2", "PERSONAL", "owner-1"),
    fact("PFS_ANNUAL_DEBT_SERVICE", "PERSONAL", "owner-1"),
    fact("PFS_LIVING_EXPENSES", "PERSONAL", "owner-1"),
  ];
}

// ── 1. Central optional-spread rule ────────────────────────────────────────

test("T12 is classified optional; primary spreads are not", () => {
  assert.equal(isOptionalSpreadType("T12"), true);
  assert.equal(isOptionalSpreadType("t12"), true, "case-insensitive");
  assert.ok(OPTIONAL_SPREAD_TYPES.has("T12"));
  for (const primary of ["BALANCE_SHEET", "GLOBAL_CASH_FLOW", "PERSONAL_INCOME", "PERSONAL_FINANCIAL_STATEMENT", "STANDARD"]) {
    assert.equal(isOptionalSpreadType(primary), false, `${primary} must be primary`);
  }
});

// ── 2. Default recompute does not request T12 unless source / explicit ──────

test("(a) default recompute drops T12 when no real T12 source exists", () => {
  const defaulted = filterOptionalSpreadsForDefaultRecompute([...ALL_SPREAD_TYPES], {
    hasOptionalSource: false,
  });
  assert.ok(!defaulted.includes("T12" as SpreadType), "T12 excluded from default recompute");
  // Primary business spreads must still be present.
  assert.ok(defaulted.includes("BALANCE_SHEET" as SpreadType));
  assert.ok(defaulted.includes("GLOBAL_CASH_FLOW" as SpreadType));
  assert.ok(defaulted.includes("STANDARD" as SpreadType));
});

test("(b) default recompute keeps T12 when the deal supplied a real T12 source", () => {
  const withSource = filterOptionalSpreadsForDefaultRecompute([...ALL_SPREAD_TYPES], {
    hasOptionalSource: true,
  });
  assert.ok(withSource.includes("T12" as SpreadType), "T12 kept when a real T12 source exists");
});

test("(c) explicit T12 request is honored by the recompute route (bypasses the default filter)", () => {
  const src = read("src/app/api/deals/[dealId]/spreads/recompute/route.ts");
  assert.ok(
    /if \(spreadTypes\.length\)/.test(src),
    "explicit per-type request must short-circuit before the optional filter",
  );
  assert.ok(
    src.includes("filterOptionalSpreadsForDefaultRecompute"),
    "default branch must apply the optional-spread filter",
  );
  assert.ok(src.includes("dealHasT12Source"), "default branch must consult the real-source gate");
});

test("(c) pipeline recompute (blanket/default) also filters optional T12", () => {
  const src = read("src/app/api/deals/[dealId]/pipeline-recompute/route.ts");
  assert.ok(src.includes("filterOptionalSpreadsForDefaultRecompute"));
  assert.ok(src.includes("dealHasT12Source"));
});

// ── 3. GCF prerequisites are fact-driven, never T12 ────────────────────────

test("missing/error T12 does not block GCF prerequisites", () => {
  const r = evaluateGcfPrerequisites(readyPrereqFacts());
  assert.equal(r.ready, true, "GCF prerequisites ready from canonical facts regardless of T12");
  assert.equal(r.earliestMissing, null);
  // T12 is not, and must never become, a GCF prerequisite key.
  const keys = r.prerequisites.map((p) => p.key);
  assert.ok(!keys.some((k) => /t12/i.test(k)), "no T12-based GCF prerequisite");
});

// ── 4. DSCR / memo readiness: canonical facts satisfy, T12 absence irrelevant ─

function memoArgs(over: Partial<Parameters<typeof evaluateMemoInputReadiness>[0]> = {}) {
  const facts: RequiredFinancialFacts = {
    dscr: 1.45,
    annualDebtService: 120_000,
    globalCashFlow: 174_000,
    loanAmount: 1_000_000,
    cashFlowAvailable: 174_000,
  };
  return {
    dealId: "deal-omni",
    borrowerStory: null,
    management: [],
    collateral: [],
    financialFacts: facts,
    research: { gate_passed: true, trust_grade: "committee_grade" as const, quality_score: 0.9 },
    conflicts: [],
    ...over,
  };
}

test("missing/error T12 does not block memo readiness or DSCR when canonical cash-flow/debt-service facts exist", () => {
  const r = evaluateMemoInputReadiness(memoArgs({ gcfPrerequisites: { ready: true, earliestMissing: null } }));
  const codes = r.blockers.map((b) => b.code);
  assert.ok(!codes.includes("missing_dscr"), "DSCR satisfied by spread/canonical facts — no DSCR blocker");
  assert.ok(!codes.includes("missing_business_cash_flow"));
  assert.ok(!codes.includes("missing_global_cash_flow"));
  // Nothing in memo readiness keys off T12.
  assert.ok(!codes.some((c) => /t12/i.test(c)), "no T12-derived memo blocker");
});

test("memo readiness REQUIRED_SPREADS and appendix never include T12", () => {
  const adapter = read("src/lib/creditMemo/canonical/factsAdapter.ts");
  assert.ok(
    /const REQUIRED_SPREADS:\s*SpreadType\[\]\s*=\s*\["GLOBAL_CASH_FLOW"\]/.test(adapter),
    "REQUIRED_SPREADS for memo readiness must be GCF-only (no T12)",
  );
  const appendix = read("src/components/creditMemo/SpreadsAppendix.tsx");
  assert.ok(appendix.includes('s.spread_type !== "T12"'), "memo appendix excludes T12");
});

// ── 5. Lifecycle next action never points to T12 ───────────────────────────

const ALL_BLOCKER_CODES = [
  "identity_not_verified", "financial_snapshot_missing", "underwrite_not_started",
  "underwrite_incomplete", "policy_exceptions_unresolved", "committee_packet_missing",
  "decision_missing", "attestation_missing", "closing_docs_missing", "pricing_quote_missing",
  "risk_pricing_not_finalized", "deal_not_found", "checklist_not_seeded", "loan_request_missing",
  "loan_request_incomplete", "spreads_incomplete", "pricing_assumptions_required",
  "structural_pricing_missing", "gatekeeper_docs_need_review", "gatekeeper_docs_incomplete",
  "intake_confirmation_required", "financial_snapshot_stale", "financial_validation_open",
  "financial_snapshot_build_failed", "financial_period_review_open", "critical_flags_unresolved",
  "borrower_not_attached", "artifacts_processing_stalled", "missing_business_description",
  "missing_revenue_model", "missing_management_profile", "missing_collateral_item",
  "missing_collateral_value", "missing_research_quality_gate", "open_fact_conflicts",
  "missing_policy_exception_review", "missing_business_cash_flow", "missing_dscr",
  "missing_global_cash_flow", "missing_debt_service_facts", "unfinalized_required_documents",
  "documents_processing_stalled", "research_stalled", "collateral_extraction_needed",
  "memo_prefill_stale",
] as const;

test("no lifecycle blocker fix-action routes to or labels T12", () => {
  for (const code of ALL_BLOCKER_CODES) {
    const fix = getBlockerFixAction({ code: code as any, message: "x" }, "deal-omni");
    if (!fix) continue;
    const label = "label" in fix ? String((fix as any).label ?? "") : "";
    const href = "href" in fix ? String((fix as any).href ?? "") : "";
    assert.ok(!/t12|trailing/i.test(label), `${code} label must not reference T12: ${label}`);
    assert.ok(!/t12|trailing/i.test(href), `${code} href must not reference T12: ${href}`);
  }
});

test("the financial fix paths point to /financials or the GCF page, never T12", () => {
  const dscr = getBlockerFixAction({ code: "missing_dscr", message: "x" }, "deal-omni")!;
  assert.equal((dscr as any).href, "/deals/deal-omni/financials");
  const gcf = getBlockerFixAction({ code: "missing_global_cash_flow", message: "x" }, "deal-omni")!;
  assert.equal((gcf as any).href, "/deals/deal-omni/spreads/global-cash-flow");
  // The lifecycle next-action module never names T12.
  const src = read("src/buddy/lifecycle/nextAction.ts");
  assert.ok(!/\bT12\b/.test(src), "nextAction.ts must not reference T12");
});

// ── 6. Readiness/blockers: an errored optional T12 must not block ──────────

// Mirror the cockpit-state route's stat builder so this test locks the rule's
// effect on the readiness engine the route actually feeds.
function buildPrimarySpreadStats(
  rows: Array<{ spread_type: string; status: string }>,
): SpreadStats {
  const primary = rows.filter((r) => !isOptionalSpreadType(r.spread_type));
  let ready = 0, errored = 0;
  const erroredTypes: string[] = [];
  for (const r of primary) {
    if (r.status === "ready") ready += 1;
    else if (r.status === "error" || r.status === "failed") {
      errored += 1;
      erroredTypes.push(r.spread_type);
    }
  }
  return { total: primary.length, ready, errored, erroredTypes, terminal: ready + errored, stuck: 0, stuckTypes: [] };
}

function readinessInput(spreadStats: SpreadStats) {
  return {
    requirements: [],
    hasLoanRequest: true,
    spreadStats,
    hasFinancialSnapshot: true,
    hasPricingQuote: false,
    hasDecision: false,
  };
}

test("(d/g) Omnicare shape: primary spreads ready + T12 orphan error → spreads complete, no spreads_errored blocker", () => {
  const rows = [
    { spread_type: "BALANCE_SHEET", status: "ready" },
    { spread_type: "PERSONAL_INCOME", status: "ready" },
    { spread_type: "PERSONAL_FINANCIAL_STATEMENT", status: "ready" },
    { spread_type: "STANDARD", status: "ready" },
    { spread_type: "T12", status: "error" }, // ORPHANED_BY_FAILED_ORCHESTRATION
  ];
  const { categories, blockers } = computeReadinessAndBlockers(readinessInput(buildPrimarySpreadStats(rows)));
  const spreadsCat = categories.find((c) => c.code === "spreads")!;
  assert.equal(spreadsCat.status, "complete", "T12 orphan must not downgrade spreads readiness");
  assert.ok(!blockers.some((b) => b.code === "spreads_errored"), "no spreads_errored blocker from optional T12");
});

test("(d) a PRIMARY spread error still blocks (rule is T12-specific, not blanket suppression)", () => {
  const rows = [
    { spread_type: "BALANCE_SHEET", status: "error" },
    { spread_type: "STANDARD", status: "ready" },
  ];
  const { blockers } = computeReadinessAndBlockers(readinessInput(buildPrimarySpreadStats(rows)));
  const errored = blockers.find((b) => b.code === "spreads_errored");
  assert.ok(errored, "a real primary spread error must still surface");
  assert.ok(errored!.details.some((d) => d.includes("BALANCE_SHEET")));
});

test("(d/e) cockpit-state and analysis-status exclude optional spreads from readiness", () => {
  const cockpit = read("src/app/api/deals/[dealId]/cockpit-state/route.ts");
  assert.ok(cockpit.includes("isOptionalSpreadType"), "cockpit-state filters optional spreads");
  const analysis = read("src/lib/underwriting/getDealAnalysisStatus.ts");
  assert.ok(analysis.includes("isOptionalSpreadType"), "analysis status ignores optional spreads");
  // loadSpreadInfo must select spread_type so it can skip optional rows.
  assert.ok(
    /select\(\s*["']id, spread_type, status, updated_at["']\s*\)/.test(analysis),
    "loadSpreadInfo must read spread_type to pick the latest non-optional row",
  );
});

// ── 7. Business Spreads UI: T12 shown but optional; balance sheet primary ───

test("(f) Business Spreads page treats balance sheet as primary and labels T12 optional", () => {
  // SPEC-BUSINESS-SPREADS-OPERATING-COMPANY-VIEW-1: spread types now come from the
  // context-aware helper. The optional T12 must still come after BALANCE_SHEET and
  // only appear when a real source exists.
  const creWithT12 = getBusinessSpreadTypesForDealContext({
    collateralType: "CRE",
    hasT12Source: true,
  });
  assert.ok(
    creWithT12.indexOf("BALANCE_SHEET") < creWithT12.indexOf("T12"),
    "BALANCE_SHEET (primary) must precede T12 (optional)",
  );
  const page = read("src/app/(app)/deals/[dealId]/spreads/business/page.tsx");
  assert.ok(page.includes("isOptionalSpreadType"), "page derives optional label from the central rule");
  assert.ok(page.includes("(optional)"), "T12 spread is labeled optional in the UI");
  assert.ok(
    page.includes("getBusinessSpreadTypesForDealContext"),
    "page builds its request from the context-aware helper",
  );
});
