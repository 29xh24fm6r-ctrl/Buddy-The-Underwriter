/**
 * SPEC-B4 Batch 1 — Methodology substrate source-level guards.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

// ── V-1: deal_methodology_choices migration exists ────────────────────────

test("[spec-b4-v1] deal_methodology_choices migration exists with correct constraints", () => {
  const migrationPath = join(
    REPO_ROOT,
    "supabase/migrations/20260615000001_deal_methodology_choices.sql",
  );
  assert.ok(existsSync(migrationPath), "Migration file must exist");

  const body = readFileSync(migrationPath, "utf8");
  assert.match(body, /deal_methodology_choices/, "Must create deal_methodology_choices table");
  assert.match(body, /PRIMARY KEY.*deal_id.*bank_id.*axis/, "Must have composite PK");
  assert.match(body, /axis_valid/, "Must have axis CHECK constraint");
  assert.match(body, /ncads_source/, "CHECK must include ncads_source");
  assert.match(body, /ebitda_addback_stack/, "CHECK must include ebitda_addback_stack");
  assert.match(body, /officer_comp/, "CHECK must include officer_comp");
  assert.match(body, /affiliate_ownership/, "CHECK must include affiliate_ownership");
  assert.match(body, /living_expense/, "CHECK must include living_expense");
  assert.match(body, /ROW LEVEL SECURITY/, "Must enable RLS");
});

// ── V-2: types.ts exports correct types ───────────────────────────────────

test("[spec-b4-v2] methodology types module exports all required types", () => {
  const body = read("src/lib/methodology/types.ts");
  assert.match(body, /export type MethodologyAxisId/, "Must export MethodologyAxisId");
  assert.match(body, /export type MethodologyVariant\b/, "Must export MethodologyVariant");
  assert.match(body, /export type MethodologySlate/, "Must export MethodologySlate");
  assert.match(body, /export type MethodologyChoice/, "Must export MethodologyChoice");
  assert.match(body, /export type MethodologyProvenance/, "Must export MethodologyProvenance");
  assert.match(body, /export type MethodologyAxis\b/, "Must export MethodologyAxis");

  // MethodologySlate must have all 5 axis keys
  assert.match(body, /ncads_source:/, "MethodologySlate must have ncads_source");
  assert.match(body, /ebitda_addback_stack:/, "MethodologySlate must have ebitda_addback_stack");
  assert.match(body, /officer_comp:/, "MethodologySlate must have officer_comp");
  assert.match(body, /affiliate_ownership:/, "MethodologySlate must have affiliate_ownership");
  assert.match(body, /living_expense:/, "MethodologySlate must have living_expense");
});

// ── V-3: methodologyAxes.ts exports correct registry ─────────────────────

test("[spec-b4-v3] METHODOLOGY_AXES registry has all 5 axes with variants", () => {
  const { METHODOLOGY_AXES } = require("@/lib/methodology/methodologyAxes");
  const axisIds = Object.keys(METHODOLOGY_AXES);
  assert.equal(axisIds.length, 5, "Must have exactly 5 axes");
  assert.ok(axisIds.includes("ncads_source"), "Must include ncads_source");
  assert.ok(axisIds.includes("ebitda_addback_stack"), "Must include ebitda_addback_stack");
  assert.ok(axisIds.includes("officer_comp"), "Must include officer_comp");
  assert.ok(axisIds.includes("affiliate_ownership"), "Must include affiliate_ownership");
  assert.ok(axisIds.includes("living_expense"), "Must include living_expense");

  // Each axis must have at least 2 variants and a defaultVariant
  for (const [id, axis] of Object.entries(METHODOLOGY_AXES) as any[]) {
    assert.ok(axis.variants.length >= 2, `${id} must have at least 2 variants`);
    assert.ok(axis.defaultVariant, `${id} must have a defaultVariant`);
    assert.ok(axis.affectedFactKeys.length > 0, `${id} must declare affectedFactKeys`);
    assert.ok(
      axis.variants.some((v: any) => v.id === axis.defaultVariant),
      `${id} defaultVariant must exist in its variants list`,
    );
  }
});

// ── V-4: methodologyDefaults.ts exports correct default slate ─────────────

test("[spec-b4-v4] DEFAULT_METHODOLOGY_SLATE matches spec defaults", () => {
  const { DEFAULT_METHODOLOGY_SLATE } = require("@/lib/methodology/methodologyDefaults");
  assert.equal(DEFAULT_METHODOLOGY_SLATE.ncads_source, "standard", "ncads_source default must be standard");
  assert.equal(DEFAULT_METHODOLOGY_SLATE.ebitda_addback_stack, "conservative", "ebitda_addback_stack default must be conservative");
  assert.equal(DEFAULT_METHODOLOGY_SLATE.officer_comp, "standard", "officer_comp default must be standard");
  assert.equal(DEFAULT_METHODOLOGY_SLATE.affiliate_ownership, "conservative", "affiliate_ownership default must be conservative");
  assert.equal(DEFAULT_METHODOLOGY_SLATE.living_expense, "standard", "living_expense default must be standard (v1.0); sba_sop_minimum is v1.0.1 target after household size wires in");
});

// ── V-5: loadDealMethodology exists ───────────────────────────────────────

test("[spec-b4-v5] loadDealMethodology.ts reads from deal_methodology_choices and merges defaults", () => {
  const body = read("src/lib/methodology/loadDealMethodology.ts");
  assert.match(body, /export async function loadDealMethodology/, "Must export loadDealMethodology");
  assert.match(body, /deal_methodology_choices/, "Must query deal_methodology_choices table");
  assert.match(body, /DEFAULT_METHODOLOGY_SLATE/, "Must reference default slate for fallback");
  assert.match(body, /isAllDefaults/, "Must expose whether all choices are defaults");
});

// ── V-6: computeEbitda accepts methodologySlate ───────────────────────────

test("[spec-b4-v6] computeEbitda accepts optional methodologySlate and branches on variant", () => {
  const body = read("src/lib/financialIntelligence/ebitdaEngine.ts");
  assert.match(body, /methodologySlate\?:\s*MethodologySlate/, "Must accept optional methodologySlate");
  assert.match(body, /ebitda_addback_stack/, "Must read ebitda_addback_stack from slate");
  assert.match(body, /addBackVariant/, "Must resolve addBackVariant from slate");

  // Behavioral parity: when omitted, must default to "standard" (all add-backs)
  const { computeEbitda } = require("@/lib/financialIntelligence/ebitdaEngine");
  const facts = {
    ORDINARY_BUSINESS_INCOME: 500_000,
    INTEREST_EXPENSE: 20_000,
    DEPRECIATION: 30_000,
    SECTION_179_EXPENSE: 15_000,
    BONUS_DEPRECIATION: 10_000,
    NON_RECURRING_EXPENSE: 5_000,
  };

  const withoutSlate = computeEbitda(facts, "FORM_1120");
  const withStandard = computeEbitda(facts, "FORM_1120", {
    ncads_source: "standard",
    ebitda_addback_stack: "standard",
    officer_comp: "standard",
    affiliate_ownership: "standard",
    living_expense: "standard",
  });

  // Without slate = standard variant = same result
  assert.equal(
    withoutSlate.adjustedEbitda,
    withStandard.adjustedEbitda,
    "computeEbitda without slate must match standard variant result",
  );

  // Conservative should exclude §179, bonus depreciation, non-recurring
  const withConservative = computeEbitda(facts, "FORM_1120", {
    ncads_source: "standard",
    ebitda_addback_stack: "conservative",
    officer_comp: "standard",
    affiliate_ownership: "standard",
    living_expense: "standard",
  });

  assert.ok(
    withConservative.adjustedEbitda! < withStandard.adjustedEbitda!,
    "Conservative add-back stack must produce lower EBITDA than standard",
  );

  // Conservative should NOT include §179 or bonus depreciation
  const conservativeKeys = withConservative.addBacks.map((ab: any) => ab.key);
  assert.ok(!conservativeKeys.includes("SECTION_179_EXPENSE"), "Conservative must exclude §179");
  assert.ok(!conservativeKeys.includes("BONUS_DEPRECIATION"), "Conservative must exclude bonus depreciation");
  assert.ok(!conservativeKeys.includes("NON_RECURRING_EXPENSE"), "Conservative must exclude non-recurring");
});

// ── V-7: analyzeOfficerComp accepts methodologySlate ──────────────────────

test("[spec-b4-v7] analyzeOfficerComp accepts optional methodologySlate and branches on variant", () => {
  const body = read("src/lib/financialIntelligence/officerCompEngine.ts");
  assert.match(body, /methodologySlate\?:\s*MethodologySlate/, "Must accept optional methodologySlate");
  assert.match(body, /officer_comp/, "Must read officer_comp from slate");
  assert.match(body, /no_normalization/, "Must handle no_normalization variant");
  assert.match(body, /marketRateBaseline/, "Must compute market rate baseline from variant");

  // Behavioral parity: without slate, uses 10% baseline (standard)
  const { analyzeOfficerComp } = require("@/lib/financialIntelligence/officerCompEngine");
  const facts = {
    OFFICER_COMPENSATION: 500_000,
    GROSS_RECEIPTS: 1_000_000,
  };

  const withoutSlate = analyzeOfficerComp(facts, "FORM_1120");
  assert.equal(withoutSlate.marketRateEstimate, 100_000, "Standard: market rate = 10% of revenue");

  const withConservative = analyzeOfficerComp(facts, "FORM_1120", {
    ncads_source: "standard",
    ebitda_addback_stack: "standard",
    officer_comp: "conservative",
    affiliate_ownership: "standard",
    living_expense: "standard",
  });
  assert.equal(withConservative.marketRateEstimate, 150_000, "Conservative: market rate = 15% of revenue");

  // No-normalization returns NORMAL flag with no add-back
  const withNoNorm = analyzeOfficerComp(facts, "FORM_1120", {
    ncads_source: "standard",
    ebitda_addback_stack: "standard",
    officer_comp: "no_normalization",
    affiliate_ownership: "standard",
    living_expense: "standard",
  });
  assert.equal(withNoNorm.flag, "NORMAL", "no_normalization must return NORMAL");
  assert.equal(withNoNorm.adjustedEbitdaImpact, null, "no_normalization must have no EBITDA impact");
});

// ── V-8: computeGlobalCashFlow accepts methodologySlate ───────────────────

test("[spec-b4-v8] computeGlobalCashFlow accepts optional methodologySlate and branches on variants", () => {
  const body = read("src/lib/financialIntelligence/computeGlobalCashFlow.ts");
  assert.match(body, /methodologySlate\?:\s*MethodologySlate/, "Must accept optional methodologySlate");
  assert.match(body, /affiliate_ownership/, "Must read affiliate_ownership from slate");
  assert.match(body, /living_expense/, "Must read living_expense from slate");
  assert.match(body, /SBA_LIVING_EXPENSE_FLOOR/, "Must define SBA living expense floor constants");

  // Behavioral parity: without slate, uses standard (assume 100%, stated obligations)
  const { computeGlobalCashFlow } = require("@/lib/financialIntelligence/computeGlobalCashFlow");
  const inputs = {
    entities: [
      { entityId: "e1", entityName: "Opco", entityType: "OPERATING" as const, ownershipPct: null, netIncome: 200_000, depreciation: 50_000, interestExpense: 20_000, debtService: 100_000 },
    ],
    sponsors: [
      { ownerId: "s1", ownerName: "Owner", totalPersonalIncome: 80_000, personalObligations: 12_000 },
    ],
    proposedDebtService: 50_000,
    existingDebtService: null,
  };

  const withoutSlate = computeGlobalCashFlow(inputs);
  // Standard: null ownership → assume 100%
  assert.equal(withoutSlate.entities[0].allocatedCashFlow, 270_000, "Standard: null ownership → 100%");

  // Conservative ownership: null → 0 (exclude)
  const conservativeSlate = {
    ncads_source: "standard",
    ebitda_addback_stack: "standard",
    officer_comp: "standard",
    affiliate_ownership: "conservative",
    living_expense: "standard",
  };
  const withConservativeOwnership = computeGlobalCashFlow(inputs, conservativeSlate);
  assert.equal(
    withConservativeOwnership.entities[0].allocatedCashFlow,
    0,
    "Conservative ownership: null → excluded (0)",
  );

  // SBA SOP minimum living expense floor
  const sbaSlate = {
    ncads_source: "standard",
    ebitda_addback_stack: "standard",
    officer_comp: "standard",
    affiliate_ownership: "standard",
    living_expense: "sba_sop_minimum",
  };
  const withSbaFloor = computeGlobalCashFlow(inputs, sbaSlate);
  // personalObligations = 12_000 but SBA floor = 24_000 → floor applies
  assert.ok(
    withSbaFloor.sponsors[0].netPersonalCashFlow! < withoutSlate.sponsors[0].netPersonalCashFlow!,
    "SBA floor must reduce personal cash flow when stated obligations are below floor",
  );
});

// ── Behavioral parity: slateHash is deterministic ─────────────────────────

test("[spec-b4-parity-1] computeSlateHash is deterministic", () => {
  const { computeSlateHash } = require("@/lib/methodology/slateHash");
  const slate = {
    ncads_source: "standard",
    ebitda_addback_stack: "conservative",
    officer_comp: "standard",
    affiliate_ownership: "conservative",
    living_expense: "sba_sop_minimum",
  };
  const hash1 = computeSlateHash(slate);
  const hash2 = computeSlateHash(slate);
  assert.equal(hash1, hash2, "Same slate must produce same hash");
  assert.equal(hash1.length, 64, "Hash must be SHA-256 (64 hex chars)");

  // Different slate must produce different hash
  const hash3 = computeSlateHash({ ...slate, officer_comp: "conservative" });
  assert.notEqual(hash1, hash3, "Different slates must produce different hashes");
});
