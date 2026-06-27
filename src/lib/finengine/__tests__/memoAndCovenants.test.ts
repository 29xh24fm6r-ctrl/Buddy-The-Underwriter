import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildCreditMemo, type MemoInputs } from "@/lib/finengine/memo/buildCreditMemo";
import { recommendCovenants, testCovenant, recommendMonitoringPackage } from "@/lib/finengine/covenants";
import { dscr } from "@/lib/finengine/metrics";
import { rateRisk } from "@/lib/finengine/riskRating";

describe("credit memo — rendered FROM certified objects (never writes math)", () => {
  const input: MemoInputs = {
    borrower: { displayName: "Acme Holdings", entityForm: "S_CORP" },
    request: { purpose: "Refinance + working capital", amount: 2_000_000, product: "SBA_7A_STANDARD" },
    metrics: [dscr(390_000, 300_000, { productId: "SBA_7A_STANDARD" })],
    globalCashFlow: { globalDSCR: 1.3, globalCashBeforeDebt: 390_000, globalDebtService: 300_000 },
    riskRating: rateRisk({ dscr: 1.3, leverage: 2.5 }, { collateralCoverage: 1.2 }),
    approvalConditions: ["Obtain 4506-C transcripts", "Perfect blanket UCC"],
  };

  it("produces ordered sections including recommendation, from the objects", () => {
    const memo = buildCreditMemo(input);
    const keys = memo.sections.map((s) => s.key);
    for (const k of ["exec_summary", "repayment", "global_cash_flow", "risk_rating", "approval_conditions", "recommendation"]) {
      assert.ok(keys.includes(k), `missing section ${k}`);
    }
    const rec = memo.sections.find((s) => s.key === "recommendation")!;
    assert.match(rec.body, /grade/);
  });

  it("carries the marketplace redaction gate explicitly", () => {
    const memo = buildCreditMemo({ ...input, redactForMarketplace: true });
    assert.equal(memo.marketplaceRedacted, true);
  });

  it("does not mutate the input objects (read-only render)", () => {
    const before = JSON.stringify(input);
    buildCreditMemo(input);
    assert.equal(JSON.stringify(input), before);
  });
});

describe("covenant recommendation + monitoring", () => {
  it("recommends a cushioned DSCR covenant resolved from the registry", () => {
    const cov = recommendCovenants({ productId: "SBA_7A_STANDARD", underwrittenDscr: 1.4 });
    const d = cov.find((c) => c.name === "DSCR")!;
    assert.equal(d.direction, "floor");
    // max(SBA standard floor 1.15, 1.40 - 0.10 = 1.30) = 1.30
    assert.equal(d.threshold, 1.3);
    assert.ok(d.citation.length > 5);
  });

  it("leverage covenant is an incurrence cap", () => {
    const cov = recommendCovenants({ productId: "CI_TERM", underwrittenLeverage: 3.0 });
    const lev = cov.find((c) => c.name === "LEVERAGE")!;
    assert.equal(lev.direction, "cap");
    assert.equal(lev.test, "incurrence");
  });

  it("tests compliance with an equity cure", () => {
    const cov = recommendCovenants({ productId: "SBA_7A_STANDARD", underwrittenDscr: 1.4 })[0];
    const breach = testCovenant(cov, 1.1);
    assert.equal(breach.inCompliance, false);
    const cured = testCovenant(cov, 1.1, 0.3); // floor cure adds to actual → 1.4 >= 1.30
    assert.equal(cured.inCompliance, true);
    assert.equal(cured.curedByEquity, true);
  });

  it("ABL monitoring package includes a borrowing-base certificate cadence", () => {
    const pkg = recommendMonitoringPackage("ABL_REVOLVER");
    assert.ok(pkg.some((p) => /Borrowing-base/.test(p.item)));
  });
});
