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
import { evaluateGcfPrerequisites } from "@/lib/financialFacts/canonicalGcfCore";

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

test("AC5c: no source-backed living/housing expense fact (only balances) → fail-closed", () => {
  // Balances must NEVER be a living-expense source: net worth, total liabilities,
  // and mortgage BALANCE are all ignored — only recurring expense/payment facts count.
  const r = derivePfsLivingExpensesByOwner([
    pfs("PFS_MORTGAGE_BALANCE", 2_000_000),
    pfs("PFS_RE1_MORTGAGE_BALANCE", 480_000),
    pfs("PFS_TOTAL_LIABILITIES", 2_741_000),
    pfs("PFS_NET_WORTH", 24_837_000),
  ]);
  assert.equal(r.derivations.length, 0);
  assert.ok(
    r.diagnostic && /not repairable from existing facts; extraction\/manual review required/i.test(r.diagnostic),
  );
});

// ── 5d. PFS living expenses from source-backed housing facts (new product rule) ──

test("AC5d: living expenses derive from PFS rent / housing monthly expense key × 12", () => {
  const r = derivePfsLivingExpensesByOwner([pfs("PFS_RENT_PAYMENT_MO", 2_500)]);
  assert.equal(r.derivations.length, 1);
  assert.equal(r.derivations[0].value, 30_000);
  assert.equal(r.derivations[0].auditNote ?? null, null, "rent expense does not overlap PFS ADS");
});

test("AC5e: living expenses derive from source-backed PFS_MORTGAGE_PAYMENT_MO × 12 (Omnicare)", () => {
  // The live Omnicare case: no explicit living-expense key, but an accepted
  // PFS_MORTGAGE_PAYMENT_MO = 18,000. Living expenses must no longer stay missing.
  const r = derivePfsLivingExpensesByOwner([pfs("PFS_MORTGAGE_PAYMENT_MO", 18_000)]);
  assert.equal(r.derivations.length, 1);
  assert.equal(r.derivations[0].value, 216_000);
  assert.equal(r.derivations[0].sourceDocumentId, "doc-pfs-1");
  // Provenance shows the components + calculation (PFS_MORTGAGE_PAYMENT_MO × 12).
  assert.match(r.derivations[0].calc, /PFS_MORTGAGE_PAYMENT_MO \(18000\) × 12 = 216000/);
  // Double-count audit note set because this payment also backs PFS_ANNUAL_DEBT_SERVICE.
  assert.ok(
    r.derivations[0].auditNote && /PFS_ANNUAL_DEBT_SERVICE/.test(r.derivations[0].auditNote),
    "audit note flags the shared housing-payment basis",
  );
});

test("AC5f: explicit living-expense key WINS over housing payment fall-through", () => {
  const r = derivePfsLivingExpensesByOwner([
    pfs("PFS_ANNUAL_LIVING_EXPENSES", 90_000),
    pfs("PFS_MORTGAGE_PAYMENT_MO", 18_000),
  ]);
  assert.equal(r.derivations.length, 1);
  assert.equal(r.derivations[0].value, 90_000, "explicit annual living-expense key preferred");
  assert.equal(r.derivations[0].auditNote ?? null, null, "no overlap note when explicit key used");
});

test("AC5g: aggregate PFS_MORTGAGE_PAYMENT_MO wins over per-property lines (no double-count)", () => {
  const r = derivePfsLivingExpensesByOwner([
    pfs("PFS_MORTGAGE_PAYMENT_MO", 18_000),
    pfs("PFS_RE1_MONTHLY_PAYMENT", 1_650),
    pfs("PFS_RE2_MONTHLY_PAYMENT", 1_000),
  ]);
  assert.equal(r.derivations.length, 1);
  assert.equal(r.derivations[0].value, 216_000, "aggregate used, per-property lines NOT added");
});

test("AC5h: no aggregate mortgage → sum distinct PFS_RE*_MONTHLY_PAYMENT lines × 12", () => {
  const r = derivePfsLivingExpensesByOwner([
    pfs("PFS_RE1_MONTHLY_PAYMENT", 1_650),
    pfs("PFS_RE2_MONTHLY_PAYMENT", 1_000),
  ]);
  assert.equal(r.derivations.length, 1);
  assert.equal(r.derivations[0].value, (1_650 + 1_000) * 12);
  assert.ok(r.derivations[0].auditNote, "per-property payment basis is flagged for double-count review");
});

test("AC5i: balances are never used even when present alongside no payment fact", () => {
  const r = derivePfsLivingExpensesByOwner([
    pfs("PFS_RE1_MORTGAGE_BALANCE", 480_000),
    pfs("PFS_MORTGAGES", 2_000_000),
  ]);
  assert.equal(r.derivations.length, 0, "balance keys must not derive a living-expense value");
});

// ── 5j. Final GCF blocker set excludes PFS_LIVING_EXPENSES once housing-derived ──

test("AC5j: GCF prereqs no longer gate on PFS_LIVING_EXPENSES once housing-derived", () => {
  const OWNER_UUID = "owner-1";
  // Omnicare-shaped facts AFTER deterministic repair materialized ADS + PFS facts.
  const repaired = [
    f("CASH_FLOW_AVAILABLE", 500_000),
    f("ANNUAL_DEBT_SERVICE", 101_250),
    pfs("WAGES_W2", 220_000),
    pfs("PFS_ANNUAL_DEBT_SERVICE", 216_000),
    // The living-expense fact derived from the housing payment by branch (d):
    pfs("PFS_LIVING_EXPENSES", 216_000),
  ].map((r) => ({ ...r, owner_entity_id: r.owner_type === "PERSONAL" ? OWNER_UUID : r.owner_entity_id }));

  const ev = evaluateGcfPrerequisites(repaired as any);
  assert.equal(ev.ready, true, "all GCF prerequisites satisfied after housing-derived living expenses");
  const personal = ev.prerequisites.find((p) => p.key === "personal_pfs")!;
  assert.equal(personal.satisfied, true);
  assert.ok(
    !/PFS_LIVING_EXPENSES/.test(ev.earliestMissing?.diagnostic ?? ""),
    "PFS_LIVING_EXPENSES is not the gating diagnostic",
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
  // The double-count audit note must be persisted in provenance AND surfaced to
  // reviewers (echoed into diagnostics) — not silently dropped.
  assert.ok(/audit_note:\s*d\.auditNote/.test(src), "audit note written into fact provenance");
  assert.ok(/diagnostics\.push\(d\.auditNote\)/.test(src), "audit note echoed to diagnostics");
});
