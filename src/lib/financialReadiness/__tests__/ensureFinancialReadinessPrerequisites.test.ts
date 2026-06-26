import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  planAnnualDebtServiceRepair,
  derivePfsAnnualDebtServiceByOwner,
  derivePfsLivingExpensesByOwner,
  hasActiveFact,
  type PrereqFactRow,
} from "@/lib/financialReadiness/financialReadinessPrereqCore";

/**
 * SPEC-FINANCIAL-READINESS-GCF-PREREQ-REPAIR-1 — pure-core decision tests.
 *
 * The orchestrator (ensureFinancialReadinessPrerequisites) delegates every
 * decision to this pure core, so these tests pin the deterministic repair
 * behavior without a database. A guard test at the bottom asserts the
 * orchestrator wires the core decisions to the canonical writers.
 *
 * Live Omnicare fixture shape (deal 1d7e7c1b-…):
 *   - latest structural pricing annual_debt_service_est = 101,250 (pricing_inputs)
 *   - stale ANNUAL_DEBT_SERVICE_PROPOSED = 75,000
 *   - PFS_MORTGAGE_PAYMENT_MO = 18,000, PFS_RE1_MONTHLY_PAYMENT = 1,650
 *   - no ANNUAL_DEBT_SERVICE, no PFS_ANNUAL_DEBT_SERVICE, no PFS_LIVING_EXPENSES
 */

const OWNER = "owner-1";

function f(
  fact_key: string,
  fact_value_num: number | null,
  over: Partial<PrereqFactRow> = {},
): PrereqFactRow {
  return {
    fact_key,
    fact_value_num,
    owner_type: "DEAL",
    is_superseded: false,
    fact_period_end: "2025-12-31",
    ...over,
  };
}

function pfs(fact_key: string, value: number, over: Partial<PrereqFactRow> = {}): PrereqFactRow {
  return f(fact_key, value, {
    owner_type: "PERSONAL",
    owner_entity_id: OWNER,
    source_document_id: "doc-pfs-1",
    ...over,
  });
}

// ── 1. ANNUAL_DEBT_SERVICE computed from current structural pricing ─────────

test("AC1: ADS missing + structural pricing present → recompute (materialize ADS)", () => {
  const plan = planAnnualDebtServiceRepair({ facts: [], latestStructuralAds: 101_250 });
  assert.equal(plan.shouldRecompute, true);
  assert.equal(plan.reason, "annual_debt_service_missing");
});

test("AC1b: ADS missing + NO structural pricing → fail-closed, route to pricing", () => {
  const plan = planAnnualDebtServiceRepair({ facts: [], latestStructuralAds: null });
  assert.equal(plan.shouldRecompute, false);
  assert.equal(plan.reason, "no_structural_pricing");
});

// ── 2. Stale proposed ADS must not outrank newer pricing ────────────────────

test("AC2: stale ANNUAL_DEBT_SERVICE_PROPOSED (75k) vs current pricing (101,250) → recompute", () => {
  const facts = [
    f("ANNUAL_DEBT_SERVICE", 75_000),
    f("ANNUAL_DEBT_SERVICE_PROPOSED", 75_000),
  ];
  const plan = planAnnualDebtServiceRepair({ facts, latestStructuralAds: 101_250 });
  assert.equal(plan.shouldRecompute, true);
  assert.equal(plan.reason, "annual_debt_service_proposed_stale");
});

test("AC2b: ADS present and proposed matches current pricing → no recompute", () => {
  const facts = [
    f("ANNUAL_DEBT_SERVICE", 101_250),
    f("ANNUAL_DEBT_SERVICE_PROPOSED", 101_250),
  ];
  const plan = planAnnualDebtServiceRepair({ facts, latestStructuralAds: 101_250 });
  assert.equal(plan.shouldRecompute, false);
  assert.equal(plan.reason, "current");
});

// ── 3. PFS annual debt service derivation ───────────────────────────────────

test("AC3: PFS_MORTGAGE_PAYMENT_MO 18,000 → PFS_ANNUAL_DEBT_SERVICE 216,000", () => {
  const r = derivePfsAnnualDebtServiceByOwner([pfs("PFS_MORTGAGE_PAYMENT_MO", 18_000)]);
  assert.equal(r.derivations.length, 1);
  assert.equal(r.derivations[0].value, 216_000);
  assert.equal(r.derivations[0].ownerEntityId, OWNER);
  assert.equal(r.derivations[0].sourceDocumentId, "doc-pfs-1");
  assert.ok(r.derivations[0].confidence <= 0.65);
});

test("AC3b: aggregate mortgage payment is NOT double-counted with per-property RE lines", () => {
  // Both present → mortgage aggregate wins (RE1 is a component of it). 18,000×12.
  const r = derivePfsAnnualDebtServiceByOwner([
    pfs("PFS_MORTGAGE_PAYMENT_MO", 18_000),
    pfs("PFS_RE1_MONTHLY_PAYMENT", 1_650),
  ]);
  assert.equal(r.derivations.length, 1);
  assert.equal(r.derivations[0].value, 216_000);
});

test("AC3c: no aggregate mortgage → sum distinct PFS_RE*_MONTHLY_PAYMENT lines × 12", () => {
  const r = derivePfsAnnualDebtServiceByOwner([
    pfs("PFS_RE1_MONTHLY_PAYMENT", 1_650),
    pfs("PFS_RE2_MONTHLY_PAYMENT", 1_000),
  ]);
  assert.equal(r.derivations.length, 1);
  assert.equal(r.derivations[0].value, (1_650 + 1_000) * 12);
});

// ── 4. PFS annual debt service negative (fail-closed) ───────────────────────

test("AC4: no PFS monthly-payment fact → no derivation + precise diagnostic", () => {
  const r = derivePfsAnnualDebtServiceByOwner([
    // balances are NOT a derivation source
    pfs("PFS_TOTAL_LIABILITIES", 2_741_000),
    pfs("PFS_MORTGAGES", 2_000_000),
  ]);
  assert.equal(r.derivations.length, 0);
  assert.ok(r.diagnostic && /not derivable/i.test(r.diagnostic));
});

test("AC4b: owner already has PFS_ANNUAL_DEBT_SERVICE → not re-derived", () => {
  const r = derivePfsAnnualDebtServiceByOwner([
    pfs("PFS_MORTGAGE_PAYMENT_MO", 18_000),
    pfs("PFS_ANNUAL_DEBT_SERVICE", 216_000),
  ]);
  assert.equal(r.derivations.length, 0);
});

// ── 5. PFS living expenses (map if source-backed; else fail-closed) ─────────

test("AC5: living expenses mapped from a recognized annual alternate key", () => {
  const r = derivePfsLivingExpensesByOwner([pfs("PFS_ANNUAL_LIVING_EXPENSES", 120_000)]);
  assert.equal(r.derivations.length, 1);
  assert.equal(r.derivations[0].value, 120_000);
});

test("AC5b: living expenses derived from a monthly alternate key × 12", () => {
  const r = derivePfsLivingExpensesByOwner([pfs("PFS_MONTHLY_LIVING_EXPENSES", 8_000)]);
  assert.equal(r.derivations.length, 1);
  assert.equal(r.derivations[0].value, 96_000);
});

test("AC5c: no source-backed living-expense fact → fail-closed with precise diagnostic", () => {
  const r = derivePfsLivingExpensesByOwner([
    pfs("PFS_MORTGAGE_PAYMENT_MO", 18_000),
    pfs("PFS_NET_WORTH", 24_837_000),
  ]);
  assert.equal(r.derivations.length, 0);
  assert.ok(
    r.diagnostic && /not repairable from existing facts; extraction\/manual review required/i.test(r.diagnostic),
  );
});

// ── hasActiveFact basics (owner-scoped) ─────────────────────────────────────

test("hasActiveFact respects owner scoping and supersession", () => {
  const facts = [
    pfs("PFS_ANNUAL_DEBT_SERVICE", 216_000),
    f("ANNUAL_DEBT_SERVICE", 101_250, { is_superseded: true }),
  ];
  assert.equal(hasActiveFact(facts, "PFS_ANNUAL_DEBT_SERVICE", { ownerType: "PERSONAL" }), true);
  assert.equal(hasActiveFact(facts, "PFS_ANNUAL_DEBT_SERVICE", { ownerType: "DEAL" }), false);
  assert.equal(hasActiveFact(facts, "ANNUAL_DEBT_SERVICE"), false, "superseded fact is not active");
});

// ── Guard: orchestrator wires the core decisions to the canonical writers ────

test("orchestrator delegates to core decisions + canonical writers (no invented facts)", () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/financialReadiness/ensureFinancialReadinessPrerequisites.ts"),
    "utf8",
  );
  assert.ok(/planAnnualDebtServiceRepair/.test(src), "uses ADS repair planner");
  assert.ok(/derivePfsAnnualDebtServiceByOwner/.test(src), "uses PFS ADS derivation");
  assert.ok(/derivePfsLivingExpensesByOwner/.test(src), "uses PFS living-expense derivation");
  assert.ok(/computeTotalDebtService/.test(src), "ADS repair runs computeTotalDebtService");
  assert.ok(/upsertDealFinancialFact/.test(src), "PFS facts written via canonical writer");
  // Living expenses must remain fail-closed — never default/invent a value.
  assert.ok(
    !/PFS_LIVING_EXPENSES[\s\S]{0,200}default/i.test(src),
    "PFS_LIVING_EXPENSES must not be defaulted",
  );
});
