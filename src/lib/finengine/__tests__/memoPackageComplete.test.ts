/**
 * SPEC-FINENGINE-MEMO-CUTOVER-1 — Phase 2 tests: engine-backed memo sections.
 *
 * Every financial memo section is now computed by the engine modules from
 * primitives (not caller-supplied), and the borrower label has its display_name
 * fallback.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildFinengineMemoPackage, resolveBorrowerLabel, type MemoSignals } from "@/lib/finengine/memo/finengineMemoPackage";
import type { GlobalCashFlowResult } from "@/lib/finengine/methods/global";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const biz = (k: string, p: string, v: number): CertifiedFactRow =>
  ({ fact_key: k, fact_period_end: p, fact_value_num: v, source_canonical_type: "BUSINESS_TAX_RETURN", owner_type: "DEAL", confidence: 0.8, extractor: "gemini_primary_v1", is_superseded: false, created_at: "2026-06-01T00:00:00Z" });

const CLEAN: CertifiedFactRow[] = [
  biz("GROSS_RECEIPTS", "2024-12-31", 28767069), biz("COST_OF_GOODS_SOLD", "2024-12-31", 25233470),
  biz("GROSS_PROFIT", "2024-12-31", 3533599), biz("NET_INCOME", "2024-12-31", 200925),
  biz("M1_TAXABLE_INCOME", "2024-12-31", 200925), biz("TAXABLE_INCOME", "2024-12-31", 200925),
  biz("DEPRECIATION", "2024-12-31", 210207),
  biz("TOTAL_CURRENT_ASSETS", "2024-12-31", 6800000), biz("TOTAL_CURRENT_LIABILITIES", "2024-12-31", 1500000),
  biz("SL_TOTAL_ASSETS", "2024-12-31", 6800000), biz("SL_TOTAL_EQUITY", "2024-12-31", 5300000),
  biz("SL_TOTAL_LIABILITIES", "2024-12-31", 1500000),
];

const base = { borrower: { displayName: "Acme Co", entityForm: "C_CORP" }, request: { amount: 2_000_000, product: "SBA_7A" } };

const GCF: GlobalCashFlowResult = {
  globalCashBeforeDebt: 700000, globalDebtService: 500000, globalDSCR: 1.4,
  businessOperating: 600000, personalContribution: 100000, totalLivingExpenses: 0,
  intercompanyEliminated: 0, ledger: [], singleCountVerified: true, ncadsProvenance: [], warnings: [],
};

const signals: MemoSignals = {
  productId: "SBA_7A_STANDARD",
  riskObligor: { dscr: 1.4, leverage: 2.5 }, // currentRatio enriched from the spread
  riskFacility: { collateralCoverage: 1.3, lienPosition: 1, guarantorSupport: 0.5 },
  stress: { baseCashFlow: 700000, baseRevenue: 28767069, grossMarginPct: 0.12, debtService: 500000, debtServiceStressed300: 560000 },
  globalCashFlow: GCF,
  collateral: { discountedValue: 1_600_000, loanExposure: 2_000_000 },
  guarantors: [{ displayName: "Jane Owner", ownershipPct: 1, isGuarantor: true }],
};

describe("Phase 2 — display_name fallback (NG4 / G5)", () => {
  it("prefers display_name, then borrower_name, then name, never blank", () => {
    assert.equal(resolveBorrowerLabel({ display_name: "Real Co", borrower_name: "B", name: "N" }), "Real Co");
    assert.equal(resolveBorrowerLabel({ display_name: null, borrower_name: "Borrower Co", name: "N" }), "Borrower Co");
    assert.equal(resolveBorrowerLabel({ display_name: "   ", borrower_name: null, name: "Name Co" }), "Name Co");
    assert.equal(resolveBorrowerLabel({ display_name: null, borrower_name: null, name: null }), "Borrower");
  });
});

describe("Phase 2 — engine computes every financial section", () => {
  const pkg = buildFinengineMemoPackage("d", CLEAN, base, { signals });

  it("risk rating is engine-computed and the risk/recommendation sections render", () => {
    assert.ok(pkg.engineInputs.riskRating, "risk rating computed");
    assert.ok(pkg.engineInputs.riskRating!.recommendedGrade >= 1);
    const risk = pkg.memo.sections.find((s) => s.key === "risk_rating");
    assert.ok(risk?.hasData);
    const rec = pkg.memo.sections.find((s) => s.key === "recommendation");
    assert.ok(rec?.hasData && /grade/.test(rec.body));
  });

  it("enriches the obligor current ratio from the spread (6.8M / 1.5M ≈ 4.53)", () => {
    // current ratio wasn't supplied in riskObligor; it must come from the spread.
    // A 4.53 current ratio should not trigger the < floor liquidity downgrade.
    assert.ok(pkg.engineInputs.riskRating!.rationale.every((r) => !/weak liquidity/i.test(r)));
  });

  it("covenant package is engine-recommended and renders", () => {
    assert.ok((pkg.engineInputs.covenants?.length ?? 0) > 0);
    assert.ok(pkg.engineInputs.covenants!.some((c) => c.name === "DSCR"));
    assert.ok(pkg.memo.sections.find((s) => s.key === "covenants")?.hasData);
  });

  it("stress battery is engine-run and renders", () => {
    assert.ok((pkg.engineInputs.stress?.length ?? 0) >= 7); // rate shock + 5 compression + stress C
    assert.ok(pkg.memo.sections.find((s) => s.key === "stress")?.hasData);
  });

  it("global cash flow + collateral render with engine figures", () => {
    assert.equal(pkg.engineInputs.globalCashFlow?.globalDSCR, 1.4);
    assert.ok(pkg.memo.sections.find((s) => s.key === "global_cash_flow")?.hasData);
    // collateral 1.6M / 2.0M = 0.8 coverage → guarantor support required
    assert.equal(pkg.engineInputs.collateral?.coverageRatio, 0.8);
    assert.equal(pkg.engineInputs.collateral?.guarantorSupportRequired, true);
    assert.ok(pkg.memo.sections.find((s) => s.key === "collateral")?.hasData);
  });

  it("the gate still gates and the spread section is appended", () => {
    assert.equal(pkg.gate.allowed, true); // clean spread
    assert.ok(pkg.memo.sections.find((s) => s.key === "credit_spread")?.hasData);
  });
});

describe("Phase 2 — backward compatible without signals", () => {
  it("no signals → no engine financial sections, gate still works", () => {
    const pkg = buildFinengineMemoPackage("d", CLEAN, base);
    assert.deepEqual(pkg.engineInputs, {});
    assert.equal(pkg.gate.allowed, true);
    assert.ok(pkg.memo.sections.length > 0);
  });
});
