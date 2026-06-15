import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

/** SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2 — integration wiring guards for #1/#4/#7/#8/#9. */

describe("#1 bank-scoped loader", () => {
  const loader = read("src/lib/classicSpread/classicSpreadLoader.ts");
  it("loadClassicSpreadData requires bankId", () => {
    assert.match(loader, /export async function loadClassicSpreadData\(dealId: string, bankId: string\)/);
  });
  it("the main facts query and GCF queries filter bank_id", () => {
    // every deal_financial_facts read in the loader must be bank-scoped
    const factReads = loader.split(".from(\"deal_financial_facts\")").length - 1;
    const bankFilters = loader.split('.eq("bank_id", bankId)').length - 1;
    assert.ok(factReads >= 3, "expected at least 3 fact reads");
    assert.ok(bankFilters >= factReads, `every fact read must filter bank_id (${bankFilters} filters / ${factReads} reads)`);
  });
  it("all callers pass bankId", () => {
    assert.match(read("src/lib/classicSpread/classicPdfWorker.ts"), /loadClassicSpreadData\(dealId, bankId\)/);
    assert.match(read("src/app/api/deals/[dealId]/classic-spread/route.ts"), /loadClassicSpreadData\(dealId, bankId\)/);
    assert.match(read("src/app/api/deals/[dealId]/spread-intelligence/route.ts"), /loadClassicSpreadData\(dealId, bankId\)/);
  });
});

describe("#4 Net AR shares the TCA derivation (gross − allowance, never blank when gross exists)", () => {
  it("netAr uses allowance ?? 0, matching the TCA roll-up", () => {
    assert.match(read("src/lib/classicSpread/classicSpreadLoader.ts"), /const netAr = ar\.map\(\(v, i\) => \(v != null \? v - \(arAllowance\[i\] \?\? 0\) : null\)\)/);
  });
});

describe("#7 UCA working-capital normalization", () => {
  const loader = read("src/lib/classicSpread/classicSpreadLoader.ts");
  it("AR delta uses the NET AR basis, not raw gross", () => {
    assert.match(loader, /const dAR = deltaFn\(netArByPeriod, false\)/);
  });
  it("other-current-liability delta uses the current operating field, not non-current SL_OTHER_LIABILITIES", () => {
    assert.match(loader, /const dOtherCL = delta\("SL_OPERATING_CURRENT_LIABILITIES", true\)/);
    assert.match(loader, /Other Current Liabilities/);
  });
});

describe("#8 PDF route runs the fact-mutating bridge BEFORE loading/rendering", () => {
  it("runCashFlowAggregator appears before loadClassicSpreadData in the GET route", () => {
    const route = read("src/app/api/deals/[dealId]/classic-spread/route.ts");
    const aggIdx = route.indexOf("runCashFlowAggregator({");
    const loadIdx = route.indexOf("loadClassicSpreadData(dealId, bankId)");
    assert.ok(aggIdx > 0 && loadIdx > 0 && aggIdx < loadIdx, "aggregator must run before the spread load");
    // and there is exactly ONE bridge call site (not duplicated post-render)
    assert.equal(route.split("runCashFlowAggregator({").length - 1, 1, "bridge must not be duplicated post-render");
  });
});

describe("#9 certification fail-closed", () => {
  it("loader sets a certified flag and defaults it to false (fail closed)", () => {
    const loader = read("src/lib/classicSpread/classicSpreadLoader.ts");
    assert.match(loader, /input\.certified = false/);
    assert.match(loader, /input\.certified = true/);
  });
  it("renderer shows NOT CERTIFIED when input.certified === false", () => {
    const r = read("src/lib/classicSpread/classicSpreadRenderer.ts");
    assert.match(r, /input\.certified === false/);
    assert.match(r, /NOT CERTIFIED/);
  });
});

describe("#6 renderer distinguishes true zero from missing", () => {
  it("fmtNumber renders 0 as \"0\", null as em dash", () => {
    const r = read("src/lib/classicSpread/classicSpreadRenderer.ts");
    assert.match(r, /if \(val === 0\) return "0"; \/\/ true zero/);
  });
});
