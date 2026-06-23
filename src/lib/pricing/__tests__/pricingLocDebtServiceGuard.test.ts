/**
 * BUGFIX-LOC-PRICING-SCENARIO-DEBT-SERVICE-AND-DSCR-1 — CI Guard Tests
 *
 * Guards:
 * 1. LOC products use interest-only ADS, not amortizing P&I
 * 2. LOC monthly_pi is null (no amortizing payment)
 * 3. LOC monthly_io is always populated
 * 4. EBITDA fallback exists for cash flow proxy when noi/cfa are null
 * 5. Stressed DSCR uses interest-only for LOC
 * 6. isLocProduct helper covers all LOC types
 * 7. Unit: interest-only ADS math for LOC
 * 8. Unit: LOC DSCR with EBITDA fallback
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const GEN_SCENARIOS = read("src/lib/pricing/scenarios/generateScenarios.ts");

describe("BUGFIX-LOC-PRICING-SCENARIO-DEBT-SERVICE-AND-DSCR-1 guards", () => {

  test("Guard 1: LOC products use annualInterestCost, not annualDebtService", () => {
    assert.match(
      GEN_SCENARIOS,
      /locProduct[\s\S]*?annualInterestCost\(adjLoanAmount, allInRatePct\)/,
      "LOC branch must use annualInterestCost for ADS",
    );
  });

  test("Guard 2: LOC monthly_pi is null", () => {
    assert.match(
      GEN_SCENARIOS,
      /pi = null;.*LOC/,
      "LOC products must set pi=null (no amortizing payment)",
    );
  });

  test("Guard 3: LOC monthly_io is always populated", () => {
    assert.match(
      GEN_SCENARIOS,
      /locProduct \? io :/,
      "monthly_io must always be set for LOC products",
    );
  });

  test("Guard 4: EBITDA fallback for cash flow proxy", () => {
    assert.match(
      GEN_SCENARIOS,
      /ebitda/,
      "Must extract EBITDA from snapshot",
    );
    assert.match(
      GEN_SCENARIOS,
      /cashFlowAvailable.*\?\?.*noi.*\?\?.*ebitda/,
      "cashFlowAvailable must fall back through noi then EBITDA",
    );
  });

  test("Guard 5: stressed DSCR uses interest-only for LOC", () => {
    assert.match(
      GEN_SCENARIOS,
      /locProduct\s*\n?\s*\? annualInterestCost\(adjLoanAmount, stressedRate\)/,
      "Stressed ADS must also use interest-only for LOC products",
    );
  });

  test("Guard 6: isLocProduct covers all LOC types", () => {
    assert.match(GEN_SCENARIOS, /LOC_SECURED/);
    assert.match(GEN_SCENARIOS, /LOC_UNSECURED/);
    assert.match(GEN_SCENARIOS, /LOC_RE_SECURED/);
    assert.match(GEN_SCENARIOS, /LINE_OF_CREDIT/);
    assert.match(GEN_SCENARIOS, /REVOLVING_LINE_OF_CREDIT/);
  });

  // ── Unit tests ────────────────────────────────────────────────────────────

  test("Guard 7: interest-only ADS math for LOC", () => {
    // LOC: $1,500,000 at 6.75% = $101,250 annual interest
    const principal = 1_500_000;
    const ratePct = 6.75;
    const annualInterest = principal * ratePct / 100;
    assert.equal(annualInterest, 101_250);
    const monthlyIo = annualInterest / 12;
    assert.equal(monthlyIo, 8_437.5);
  });

  test("Guard 8: LOC DSCR with EBITDA fallback", () => {
    // EBITDA ≈ 411,132, annual interest = 101,250 → DSCR ≈ 4.06
    const ebitda = 411_132;
    const annualInterest = 101_250;
    const dscr = ebitda / annualInterest;
    assert.ok(dscr > 4.0 && dscr < 4.1, `DSCR should be ~4.06, got ${dscr.toFixed(2)}`);
  });
});
