import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { evaluateMemoInputReadiness } from "@/lib/creditMemo/inputs/evaluateMemoInputReadiness";
import {
  evaluateGcfPrerequisites,
  resolveCanonicalGcf,
  type GcfFactRow,
} from "@/lib/financialFacts/canonicalGcfCore";
import { getBlockerFixAction } from "@/buddy/lifecycle/nextAction";
import type { RequiredFinancialFacts } from "@/lib/creditMemo/inputs/types";

/**
 * SPEC-FINANCIALS-BEFORE-GCF-SEQUENCING-1 regression guard.
 *
 * GCF is a downstream aggregate. Memo readiness must sequence financial blockers
 * by dependency (business cash flow → ADS → personal/PFS → GCF → DSCR), and the
 * GCF/DSCR fix paths must point to the EARLIEST unresolved upstream step rather
 * than dead-ending on the GCF compute page that cannot compute yet.
 *
 * Live Omnicare regression: GCF showed ORPHANED_BY_FAILED_ORCHESTRATION with
 * missing CASH_FLOW_AVAILABLE, ANNUAL_DEBT_SERVICE, PFS_ANNUAL_DEBT_SERVICE, and
 * PFS_LIVING_EXPENSES — i.e. GCF was offered before its prerequisites existed.
 */

const root = process.cwd();
const DEAL = "deal-omni";
const GCF_PAGE = "src/app/(app)/deals/[dealId]/spreads/global-cash-flow/page.tsx";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(root, rel), "utf8");
}

function fact(fact_key: string, owner_type = "DEAL", owner_entity_id?: string): GcfFactRow {
  return { fact_key, fact_value_num: 1, owner_type, owner_entity_id, is_superseded: false };
}

/** Facts that satisfy ALL GCF prerequisites (the Omnicare-ready state). */
function readyPrereqFacts(): GcfFactRow[] {
  return [
    fact("CASH_FLOW_AVAILABLE"),
    fact("ANNUAL_DEBT_SERVICE"),
    fact("WAGES_W2", "PERSONAL", "owner-1"),
    fact("PFS_ANNUAL_DEBT_SERVICE", "PERSONAL", "owner-1"),
    fact("PFS_LIVING_EXPENSES", "PERSONAL", "owner-1"),
  ];
}

// ── 1. Pure prerequisite evaluator: dependency order ───────────────────────

test("evaluateGcfPrerequisites: empty facts → earliest missing is business cash flow", () => {
  const r = evaluateGcfPrerequisites([]);
  assert.equal(r.ready, false);
  assert.equal(r.earliestMissing?.key, "business_cash_flow");
  assert.equal(r.prerequisites.map((p) => p.key).join(","), "business_cash_flow,annual_debt_service,personal_pfs");
});

test("evaluateGcfPrerequisites: business cash flow present → earliest is annual debt service", () => {
  const r = evaluateGcfPrerequisites([fact("CASH_FLOW_AVAILABLE")]);
  assert.equal(r.earliestMissing?.key, "annual_debt_service");
  assert.equal(r.earliestMissing?.fixPathSuffix, "/financials");
});

test("evaluateGcfPrerequisites: business + ADS present → earliest is personal/PFS", () => {
  const r = evaluateGcfPrerequisites([fact("CASH_FLOW_AVAILABLE"), fact("ANNUAL_DEBT_SERVICE")]);
  assert.equal(r.earliestMissing?.key, "personal_pfs");
  assert.equal(r.earliestMissing?.fixPathSuffix, "/memo-inputs#management");
});

test("evaluateGcfPrerequisites: all prerequisites present → ready, no missing", () => {
  const r = evaluateGcfPrerequisites(readyPrereqFacts());
  assert.equal(r.ready, true);
  assert.equal(r.earliestMissing, null);
});

test("resolveCanonicalGcf exposes prerequisites + readiness", () => {
  const r = resolveCanonicalGcf({ spreadRows: [], factRows: [] });
  assert.equal(r.prerequisitesReady, false);
  assert.equal(r.earliestMissingPrerequisite?.key, "business_cash_flow");
  assert.equal(r.prerequisites.length, 3);

  const ready = resolveCanonicalGcf({ spreadRows: [], factRows: readyPrereqFacts() });
  assert.equal(ready.prerequisitesReady, true);
  assert.equal(ready.earliestMissingPrerequisite, null);
});

// ── 2. Memo readiness dependency ordering ──────────────────────────────────

function noFinancials(): RequiredFinancialFacts {
  return {
    dscr: null,
    annualDebtService: null,
    globalCashFlow: null,
    loanAmount: 1_000_000,
    cashFlowAvailable: null,
  };
}

function memoArgs(over: Partial<Parameters<typeof evaluateMemoInputReadiness>[0]> = {}) {
  return {
    dealId: DEAL,
    borrowerStory: null,
    management: [],
    collateral: [],
    financialFacts: noFinancials(),
    research: { gate_passed: true, trust_grade: "committee_grade" as const, quality_score: 0.9 },
    conflicts: [],
    ...over,
  };
}

test("memo readiness emits missing_business_cash_flow and orders it before GCF/DSCR", () => {
  const r = evaluateMemoInputReadiness(
    memoArgs({ gcfPrerequisites: { ready: false, earliestMissing: evaluateGcfPrerequisites([]).earliestMissing } }),
  );
  const codes = r.blockers.map((b) => b.code);
  assert.ok(codes.includes("missing_business_cash_flow"), "business cash flow blocker emitted");

  const idxBcf = codes.indexOf("missing_business_cash_flow");
  const idxGcf = codes.indexOf("missing_global_cash_flow");
  const idxDscr = codes.indexOf("missing_dscr");
  assert.ok(idxBcf < idxGcf, "business cash flow must come before GCF");
  assert.ok(idxGcf < idxDscr, "GCF must come before DSCR (DSCR is most downstream)");
});

test("AC1: GCF is not the FIRST financial next action when business financials are missing", () => {
  // Non-financial inputs all satisfied → the first remaining blocker is financial.
  const r = evaluateMemoInputReadiness(
    memoArgs({
      gcfPrerequisites: { ready: false, earliestMissing: evaluateGcfPrerequisites([]).earliestMissing },
    }),
  );
  const financialCodes = r.blockers
    .map((b) => b.code)
    .filter((c) =>
      ["missing_business_cash_flow", "missing_debt_service_facts", "missing_global_cash_flow", "missing_dscr"].includes(c),
    );
  assert.equal(
    financialCodes[0],
    "missing_business_cash_flow",
    "the first financial next action must be business cash flow, never GCF",
  );
  assert.notEqual(financialCodes[0], "missing_global_cash_flow");
});

// ── 3. missing_dscr earliest-upstream fixPath selection ────────────────────

test("AC2: missing_dscr routes to the earliest unresolved upstream step", () => {
  // business cash flow missing → /financials
  let r = evaluateMemoInputReadiness(
    memoArgs({ gcfPrerequisites: { ready: false, earliestMissing: evaluateGcfPrerequisites([]).earliestMissing } }),
  );
  let dscr = r.blockers.find((b) => b.code === "missing_dscr")!;
  assert.equal(dscr.fixPath, `/deals/${DEAL}/financials`);

  // business + ADS present, personal/PFS missing → /memo-inputs#management
  const personalMissing = evaluateGcfPrerequisites([fact("CASH_FLOW_AVAILABLE"), fact("ANNUAL_DEBT_SERVICE")]);
  r = evaluateMemoInputReadiness(
    memoArgs({
      financialFacts: { ...noFinancials(), cashFlowAvailable: 1, annualDebtService: 1 },
      gcfPrerequisites: { ready: false, earliestMissing: personalMissing.earliestMissing },
    }),
  );
  dscr = r.blockers.find((b) => b.code === "missing_dscr")!;
  assert.equal(dscr.fixPath, `/deals/${DEAL}/memo-inputs#management`);
});

test("AC5: when prerequisites are READY, GCF/DSCR fixPaths point at the GCF compute page", () => {
  const r = evaluateMemoInputReadiness(
    memoArgs({
      financialFacts: { ...noFinancials(), cashFlowAvailable: 1, annualDebtService: 1 },
      gcfPrerequisites: { ready: true, earliestMissing: null },
    }),
  );
  const gcf = r.blockers.find((b) => b.code === "missing_global_cash_flow")!;
  const dscr = r.blockers.find((b) => b.code === "missing_dscr")!;
  assert.equal(gcf.fixPath, `/deals/${DEAL}/spreads/global-cash-flow`);
  assert.equal(dscr.fixPath, `/deals/${DEAL}/spreads/global-cash-flow`);
});

// ── 4. Lifecycle wiring for the new code ───────────────────────────────────

test("missing_business_cash_flow has a cockpit fix action to financial analysis", () => {
  const action = getBlockerFixAction({ code: "missing_business_cash_flow" } as any, DEAL);
  assert.ok(action, "must return a fix action");
  assert.equal((action as any).href, `/deals/${DEAL}/financials`);
});

// ── 5. GCF page compute gate (AC3) ─────────────────────────────────────────

test("AC3: GCF page disables Compute and shows upstream CTAs when prerequisites missing", () => {
  const src = read(GCF_PAGE);
  // Gate flag derived from canonical prerequisitesReady.
  assert.ok(/prerequisitesReady === false/.test(src), "computeBlocked derives from prerequisitesReady");
  // Compute/Retry buttons are disabled while blocked.
  assert.ok(
    /disabled=\{recomputing \|\| isComputing \|\| computeBlocked\}/.test(src),
    "Compute/Retry must be disabled when computeBlocked",
  );
  // Banker-facing upstream message + actionable links.
  assert.ok(/Run upstream financial analysis first/.test(src), "shows the upstream-first heading");
  assert.ok(/prereqHref\(/.test(src) && /missingPrereqs/.test(src), "renders prerequisites as links");
});
