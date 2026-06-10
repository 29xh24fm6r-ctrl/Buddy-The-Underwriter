import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { assessDenominatorCompleteness } from "../debtServiceCompleteness";

/**
 * SPEC-GLOBAL-DEBT-SERVICE-DENOMINATOR-1 (PR-519) — proposed-loan-only ADS must not
 * masquerade as DSCR; business DSCR uses the total denominator; global DSCR is
 * preliminary until guarantor/personal obligations are confirmed.
 */

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

describe("assessDenominatorCompleteness", () => {
  it("no existing-debt rows + no guarantor data → existing not on file, global preliminary", () => {
    const c = assessDenominatorCompleteness({ existingDebtRowsPresent: false, guarantorObligationsConfirmed: false });
    assert.equal(c.existingDebtOnFile, false);
    assert.equal(c.globalDscrPreliminary, true);
    assert.match(c.businessNote, /no existing-debt schedule/i);
    assert.match(c.globalNote, /PRELIMINARY/);
  });
  it("existing rows + guarantor confirmed → complete, global not preliminary", () => {
    const c = assessDenominatorCompleteness({ existingDebtRowsPresent: true, guarantorObligationsConfirmed: true });
    assert.equal(c.existingDebtOnFile, true);
    assert.equal(c.globalDscrPreliminary, false);
    assert.match(c.globalNote, /includes confirmed/i);
  });
  it("existing business debt on file but no guarantor data → global still preliminary", () => {
    const c = assessDenominatorCompleteness({ existingDebtRowsPresent: true, guarantorObligationsConfirmed: false });
    assert.equal(c.existingDebtOnFile, true);
    assert.equal(c.globalDscrPreliminary, true);
  });
});

describe("proposed ADS cannot masquerade as DSCR (OmniCare-shaped)", () => {
  const agg = read("src/lib/financialFacts/runCashFlowAggregator.ts");

  it("runCashFlowAggregator (which holds proposed ADS) writes proposed-only keys, never DSCR/total ADS", () => {
    assert.match(agg, /ANNUAL_DEBT_SERVICE_PROPOSED/);
    assert.match(agg, /PROPOSED_LOAN_COVERAGE/);
    // It must not emit a bare DSCR or total ANNUAL_DEBT_SERVICE fact.
    assert.ok(!/factsToWrite[\s\S]*?key:\s*"DSCR"/.test(agg), "no bare DSCR fact");
    assert.ok(!/factsToWrite[\s\S]*?key:\s*"ANNUAL_DEBT_SERVICE"\s*,/.test(agg), "no total ANNUAL_DEBT_SERVICE fact");
  });

  it("the aggregator no longer owns ANNUAL_DEBT_SERVICE / DSCR in the writer registry", () => {
    const reg = read("src/lib/financialFacts/canonicalWriters.ts");
    const aggBlock = reg.slice(reg.indexOf("runCashFlowAggregator: {"), reg.indexOf("backfillCanonicalFactsFromSpreads:"));
    assert.ok(aggBlock.includes("ANNUAL_DEBT_SERVICE_PROPOSED"));
    assert.ok(aggBlock.includes("PROPOSED_LOAN_COVERAGE"));
    assert.ok(!/ownedFactKeys[\s\S]*?"DSCR"/.test(aggBlock), "aggregator must not own DSCR");
  });
});

describe("computeTotalDebtService is the sole DSCR owner and labels the denominator", () => {
  const tds = read("src/lib/structuralPricing/computeTotalDebtService.ts");

  it("DSCR provenance declares the total business denominator + existing-debt status", () => {
    assert.match(tds, /denominator:\s*"total_business_ads"/);
    assert.match(tds, /existing_debt_on_file/);
  });
  it("GCF_DSCR provenance carries the preliminary / global-obligations-confirmed flags", () => {
    assert.match(tds, /preliminary:\s*completeness\.globalDscrPreliminary/);
    assert.match(tds, /global_obligations_confirmed/);
  });
  it("assesses completeness from existing-debt rows + guarantor evidence", () => {
    assert.match(tds, /assessDenominatorCompleteness/);
    assert.match(tds, /PFS_ANNUAL_DEBT_SERVICE|buddy_guarantor_cashflow/);
  });
});
