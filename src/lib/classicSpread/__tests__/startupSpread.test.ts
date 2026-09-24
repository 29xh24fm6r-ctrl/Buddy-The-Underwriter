import test from "node:test";
import assert from "node:assert/strict";
import { startupSpreadBlockers, startupOpeningRows, startupProjectionRows, type StartupSpread } from "../startupSpread";
import { checkSpreadPreflight } from "../../spreads/preflight/spreadPreflightPure";
import { computeClassicPdfInputsHash } from "../classicPdfInputsHash";
import { renderClassicSpread } from "../classicSpreadRenderer";
import type { ClassicSpreadInput } from "../types";
import { auditStartupSpread, bindStartupSpreadAudit } from "../startupSpreadAudit";
import { computeCertificationDecisions } from "../certification/certifiedSpreadGateCore";

const startup: StartupSpread = {
  businessStage: "pre_opening", confirmedAt: "2026-09-21T12:00:00Z", openingDate: "2026-09-21",
  openingBalance: { cash: 250000, totalAssets: 250000, totalLiabilities: 0, equity: 250000 },
  projections: ([1,2,3] as const).map(year => ({ year, label: "Projected", revenue: 1500000,
    cogs: 450000, grossProfit: 1050000, grossMarginPct: .7, operatingExpenses: 650000,
    ebitda: 400000, depreciation: 0, ebit: 400000, interestExpense: 95000, taxEstimate: 100000,
    netIncome: 205000, totalDebtService: 150000, dscr: 400000/150000 })),
};
function spread(): ClassicSpreadInput {
  return { dealId: "qa", companyName: "Startup QA", preparedDate: "2026-09-22", naicsCode: null,
    naicsDescription: null, bankName: "Test", periods: [], balanceSheet: [], incomeStatement: [],
    cashFlow: [], cashFlowPeriods: [], ratioSections: [], globalCashFlow: null,
    executiveSummary: {assets:[], liabilitiesAndNetWorth:[], incomeStatement:[]}, startup: structuredClone(startup) };
}
const preflight = (value?: StartupSpread) => checkSpreadPreflight({balanceSheetRowCount:0,
  incomeStatementRowCount:0,sourceDocuments:[],startup:value});

test("documented startup passes while the same missing historical statements still block an operating business", () => {
  assert.equal(preflight(startup).status,"ok");
  assert.equal(preflight().status,"blocked");
  assert.deepEqual(startupSpreadBlockers(startup),[]);
});
test("missing opening cash, imbalance, incomplete forecasts, unconfirmed or mislabeled forecasts fail closed", () => {
  const bad: StartupSpread[] = [];
  let value=structuredClone(startup); delete value.openingBalance.cash; bad.push(value);
  value=structuredClone(startup); value.openingBalance.totalAssets=900000; bad.push(value);
  value=structuredClone(startup); value.projections.pop(); bad.push(value);
  value=structuredClone(startup); value.projections[0].label="Actual"; bad.push(value);
  value=structuredClone(startup); value.projections[0].dscr=99; bad.push(value);
  value=structuredClone(startup); value.projections[0].cogs=NaN; bad.push(value);
  value=structuredClone(startup); value.confirmedAt=""; bad.push(value);
  value=structuredClone(startup); value.openingDate="1900-01-01"; bad.push(value);
  for (const input of bad) assert.equal(preflight(input).status,"blocked");
});
test("presentation preserves nulls and true zero and uses the unchanged authoritative forecast", () => {
  const before=JSON.stringify(startup);
  const rows=startupOpeningRows(startup);
  assert.deepEqual(rows.find(r=>r.label==="Total liabilities")?.values,[0]);
  assert.deepEqual(rows.find(r=>r.label==="Accounts receivable")?.values,[null]);
  assert.deepEqual(startupProjectionRows(startup).find(r=>r.label==="Revenue")?.values,startup.projections.map(p=>p.revenue));
  assert.equal(JSON.stringify(startup),before);
});
test("changed forecast or opening balance invalidates the cached PDF", () => {
  const input=spread(); const before=computeClassicPdfInputsHash(input);
  input.startup!.projections[0].revenue+=1;
  assert.notEqual(computeClassicPdfInputsHash(input),before);
  const next=spread(); next.startup!.openingBalance.cash=250001;
  assert.notEqual(computeClassicPdfInputsHash(next),before);
});

test("startup audit checks the rendered opening and all forecast equations, not absent Schedule-L rows", () => {
  const result = auditStartupSpread(startup);
  assert.equal(result.status, "clean");
  assert.equal(result.summary.footingsChecked, 16);
  assert.deepEqual(result.summary.periodsAudited, ["Opening", "Projected Year 1", "Projected Year 2", "Projected Year 3"]);
  for (const field of ["grossProfit", "ebitda", "ebit", "netIncome", "dscr"] as const) {
    const bad = structuredClone(startup);
    bad.projections[1][field] += 10;
    assert.equal(auditStartupSpread(bad).status, "blocker", field);
  }
});

test("startup audit resolves covered model aliases while preserving source conflicts and missing guarantor evidence", () => {
  const input = spread();
  input.certified = true;
  const audit = computeCertificationDecisions([], { periods: [], gcfTaxYear: 2024 }).audit;
  const source = auditStartupSpread(startup);
  const alias = { period: "YTD 2026", statement: "balance_sheet" as const, rowLabel: "CASH_AND_EQUIVALENTS",
    issueType: "missing_source_mapping" as const, expectedValue: 250000, actualValue: null, difference: null,
    tolerance: 1, sourceFactIds: ["source"], documentIds: ["opening"], severity: "warning" as const, detail: "Legacy row not mapped" };
  source.findings = [alias];
  audit.spreadAccuracy = source;
  input.certificationAudit = audit;
  bindStartupSpreadAudit(input);
  assert.equal(input.certificationAudit!.spreadAccuracy!.summary.unmappedFactKeys, 0);
  assert.equal(input.startup!.historicalSourceAudit, audit);
  assert.equal(input.certificationSummary!.domains.globalCashFlow.status, "blocked");
  assert.match(input.certificationSummary!.domains.globalCashFlow.reasons.join(" "), /ongoing guarantor income/);
  assert.doesNotMatch(input.certificationSummary!.notes.join(" "), /1900|re-run spread/);
  assert.notEqual(input.certificationSummary!.status, "certified");

  const preserved = structuredClone(startup);
  preserved.historicalSourceAudit = structuredClone(audit);
  preserved.historicalSourceAudit.spreadAccuracy!.findings = [
    { ...alias, rowLabel: "UNKNOWN_SOURCE_LINE" },
    { ...alias, severity: "blocker", issueType: "contradictory_components", detail: "Conflicting source totals" },
  ];
  const result = auditStartupSpread(preserved);
  assert.equal(result.status, "blocker");
  assert.equal(result.summary.warnings, 1);
  assert.equal(result.summary.blockers, 1);
  assert.equal(result.actionSummary.unresolvedActionCount, 2);
  preserved.historicalSourceAudit.spreadAccuracy!.findings = [{ ...alias, expectedValue: 350000 }];
  assert.equal(auditStartupSpread(preserved).status, "blocker", "a known alias with a different value cannot be silently cleared");
});

test("startup binding cannot upgrade an incomplete source certification gate", () => {
  const input = spread(); input.certified = false;
  bindStartupSpreadAudit(input);
  assert.equal(input.certified, false);
  assert.equal(input.certificationSummary, undefined);
});

test("changed downside or guarantor evidence invalidates the startup PDF cache", () => {
  const input = spread(); const before = computeClassicPdfInputsHash(input);
  input.startup!.sensitivityScenarios = [{ name: "downside", dscrYear1: 1.44, dscrYear2: .77, dscrYear3: .14, passesSBAThreshold: false } as any];
  assert.notEqual(computeClassicPdfInputsHash(input), before);
  const changed = computeClassicPdfInputsHash(input);
  input.startup!.globalCashFlow = { evidenceStatus: "needs_information", globalDSCR: null } as any;
  assert.notEqual(computeClassicPdfInputsHash(input), changed);
});
test("actual PDF renderer accepts complete startup input without historical rows and rejects incomplete input", async () => {
  const input=spread(); const before=JSON.stringify(input);
  const pdf=await renderClassicSpread(input);
  assert.equal(pdf.subarray(0,4).toString(),"%PDF");
  assert.ok(pdf.length>2000);
  assert.equal(JSON.stringify(input),before);
  if(process.env.STARTUP_PDF_TEST_OUTPUT) {
    const {writeFile}=await import("node:fs/promises");
    await writeFile(process.env.STARTUP_PDF_TEST_OUTPUT,pdf);
  }
  delete input.startup!.openingBalance.cash;
  await assert.rejects(renderClassicSpread(input),/Startup spread incomplete/);
});

test("package worker persists the startup PDF from the frozen model and blocks an incomplete retry", async () => {
  const { createRequire } = await import("node:module");
  const { mockServerOnly } = await import("../../../../test/utils/mockServerOnly");
  mockServerOnly();
  const require = createRequire(import.meta.url);
  const { deterministicHash } = require("../../modelEngine/hashing");
  const input = spread();
  let persisted: any = null;
  const sb = { from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const q: any = { select:()=>q, eq:(key:string,value:unknown)=>{filters[key]=value;return q;}, not:()=>q, maybeSingle:async()=>({data:null,error:null}),
      single:async()=>{
        assert.equal(table,"deal_model_snapshots");
        assert.deepEqual(filters,{id:"frozen",deal_id:"qa",bank_id:"bank"});
        const output={spreadInput:structuredClone(input)};
        return {data:{id:"frozen",deal_id:"qa",bank_id:"bank",model_version:PACKAGE_FINANCIAL_VERSION,
          package_input_hash:"test-input",package_output:output,outputs_hash:deterministicHash(output)},error:null};
      },
      then:(resolve:any)=>Promise.resolve({data:[],error:null}).then(resolve),
      upsert:async(row:any)=>{persisted=row;return {error:null};} };
    return q;
  } };
  const stub=(name:string,exports:unknown)=>{require.cache[require.resolve(name)]={exports:{__esModule:true,...exports as object},loaded:true} as any;};
  stub("../../supabase/admin",{supabaseAdmin:()=>sb});
  const { PACKAGE_FINANCIAL_VERSION } = require("../../modelEngine/packageFinancialSnapshot");
  stub("../classicSpreadLoader",{loadClassicSpreadData:async()=>{throw new Error("Must not reload mutable financials");}});
  stub("../latestCanonicalFactsTimestamp",{loadLatestCanonicalFactsTimestamp:async()=>null});
  stub("../narrativeEngine",{generateSpreadNarrative:async()=>null});
  stub("../../ledger/writeEvent",{writeEvent:async()=>{}});
  const {renderClassicPdfSpread}=require("../classicPdfWorker");
  assert.equal((await renderClassicPdfSpread({dealId:"qa",bankId:"bank",financialSnapshotId:"frozen"})).ok,true);
  assert.equal(persisted.status,"ready");
  assert.equal(persisted.rendered_json.financialSnapshotId,"frozen");
  assert.ok(persisted.rendered_json.financialRenderInputHash);
  assert.equal(Buffer.from(persisted.rendered_json.pdf_base64,"base64").subarray(0,4).toString(),"%PDF");
  persisted=null;
  delete input.startup!.openingBalance.cash;
  const failed=await renderClassicPdfSpread({dealId:"qa",bankId:"bank",financialSnapshotId:"frozen"});
  assert.equal(failed.errorCode,"PREFLIGHT_BLOCKED");
  assert.equal(persisted,null);
});
