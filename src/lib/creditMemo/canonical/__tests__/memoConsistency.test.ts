import assert from "node:assert/strict";
import test from "node:test";
import { shouldRefreshCovenantDraft, supportedMemoRatios } from "../memoConsistency";
import { buildPreflightInput } from "../buildPreflightInput";
import { runMemoPreflight } from "../memoPreflight";
import { runCovenantRuleEngine } from "../../../covenants/covenantRuleEngine";
import type { CovenantPackage } from "../../../covenants/covenantTypes";
import type { CanonicalCreditMemoV1, RatioAnalysisRow } from "../types";

function pkg(floor = 1.2): CovenantPackage {
  const set = runCovenantRuleEngine({ riskGrade: "5 — WATCH", governedDscrFloor: floor,
    dealType: "operating_company", actualDscr: 2.62, actualLeverage: null,
    actualDebtYield: null, actualOccupancy: null, actualGlobalCashFlow: null, loanAmount: 850000 });
  return { dealId: "qa", generatedAt: "2026-08-26", riskGrade: "5 — WATCH",
    dealType: "operating_company", financial: set.financial, reporting: set.reporting,
    affirmativeNegative: set.behavioral, springing: set.springing, rationale: "",
    customizations: [], bankerNotes: "", snapshotHash: null, ruleEngineVersion: "1.0.0" };
}
const roa = { metric: "Return on Assets (ROA)", value: 0.12 } as RatioAnalysisRow;
const dscr = { metric: "DSCR", value: 2.62 } as RatioAnalysisRow;

test("live stale 1.20 draft refreshes through the existing engine to 1.15", () => {
  assert.equal(shouldRefreshCovenantDraft(pkg(), "draft", 1.15), true);
  const fresh = pkg(1.15);
  assert.equal(shouldRefreshCovenantDraft(fresh, "draft", 1.15), false);
  assert.match(fresh.financial[0].draftLanguage, /1.15x/);
});

test("never replace approved, customized, noted or banker-edited packages", () => {
  assert.equal(shouldRefreshCovenantDraft(pkg(), "approved", 1.15), false);
  for (const modify of [
    (p: CovenantPackage) => { p.customizations = ["Negotiated floor"]; },
    (p: CovenantPackage) => { p.bankerNotes = "Keep this floor"; },
    (p: CovenantPackage) => { p.financial[0].source = "banker_override"; },
  ]) {
    const p = pkg(); modify(p);
    assert.equal(shouldRefreshCovenantDraft(p, "draft", 1.15), false);
  }
});

test("omit ROA when either governed component is absent without removing coverage", () => {
  for (const [ni, assets] of [[null, 1680000], [210000, null], [210000, 0], [NaN, 1680000]]) {
    assert.deepEqual(supportedMemoRatios([roa, dscr], ni, assets), [dscr]);
  }
  assert.deepEqual(supportedMemoRatios([roa, dscr], 0, 1680000), [roa, dscr]);
});

test("production-shaped repaired memo passes preflight while original failures stay blocked", () => {
  const memo = { stress_testing: { policy_dscr_floor: 1.15 }, covenant_package: pkg(),
    policy_exceptions: [], financial_analysis: { revenue: { value: 2753880 },
      net_income: { value: null }, ebitda: { value: 360000 },
      balance_sheet_table: [{ total_assets: 1680000 }], ratio_analysis: [roa, dscr] },
  } as unknown as CanonicalCreditMemoV1;
  const before = runMemoPreflight(buildPreflightInput(memo));
  assert.deepEqual(before.findings.map(f => f.code), ["dscr_floor_disagreement_covenant", "derived_figure_without_governed_basis"]);
  memo.covenant_package = pkg(1.15);
  memo.financial_analysis.ratio_analysis = supportedMemoRatios([roa, dscr], null, 1680000);
  assert.equal(runMemoPreflight(buildPreflightInput(memo)).ok, true);
});
