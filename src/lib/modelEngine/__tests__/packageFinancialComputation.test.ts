import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import { projectionFixture } from "../../sba/__tests__/projectionLedger.fixture";
import { buildFinancialModel } from "../buildFinancialModel";
mockServerOnly();
const require = createRequire(import.meta.url);
let facts = JSON.parse(readFileSync("src/lib/modelEngine/__tests__/packageFinancialFacts.fixture.json", "utf8"));
let reads = 0;
let startupFixture: ReturnType<typeof projectionFixture> | null = null;
let stage: string | null = null;
let reportStatus = "PASS";
let savedReports: any[] = [];
let writeTables: string[] = [];
const assumptions = {
  id: "assumptions-1", status: "confirmed", confirmed_at: "2026-09-17T00:00:00Z",
  revenue_streams: [{ id: "r1", name: "Manufacturing", pricingModel: "flat", baseAnnualRevenue: 2400000, growthRateYear1: .1, growthRateYear2: .1, growthRateYear3: .1, seasonalityProfile: null }],
  cost_assumptions: { cogsPercentYear1: .55, cogsPercentYear2: .55, cogsPercentYear3: .55,
    fixedCostCategories: [{ id:"w",name:"Payroll",annualAmount:600000,escalationPctPerYear:.03 }], plannedHires: [], plannedCapex: [] },
  working_capital: { targetDSO: 42,targetDPO:30,inventoryTurns:6 },
  loan_impact: { loanAmount:1000000,termMonths:120,interestRate:.105,existingDebt:[],equityInjectionAmount:0,equityInjectionSource:"cash_savings",sellerFinancingAmount:0,sellerFinancingTermMonths:0,sellerFinancingRate:0,otherSources:[] },
  management_team: [{ name:"Test Owner",title:"President",yearsInIndustry:17,bio:"Seventeen years of manufacturing management experience." }],
};
const client = { from(table: string) {
  reads++;
  const debtBalance = facts.filter((f:any)=>["TOTAL_LONG_TERM_DEBT", "SHORT_TERM_DEBT"].includes(f.fact_key)).reduce((sum:number,f:any)=>sum+f.fact_value_num,0);
  const reviewedAssumptions = {...assumptions,loan_impact:{...assumptions.loan_impact,existingDebt:debtBalance ? [{description:"Retained equipment notes",currentBalance:debtBalance,monthlyPayment:10000,remainingTermMonths:72}] : []}};
  const values: Record<string,unknown> = { buddy_validation_reports:savedReports.at(-1) ?? {overall_status:reportStatus}, deal_financial_facts:facts, borrower_concierge_sessions:{confirmed_facts:{package_answers:{B07:{value:stage}}}}, buddy_sba_assumptions:reviewedAssumptions,
    deals:{name:"Synthetic Manufacturer",bank_id:"bank-1",deal_type:"SBA",loan_amount:1000000},
    deal_proceeds_items:[{category:"equipment",description:"Equipment",amount:1000000}],buddy_guarantor_cashflow:[],deal_ownership_entities:[],deal_ownership_interests:[] };
  if (startupFixture) {
    const a = startupFixture.assumptions;
    values.buddy_sba_assumptions = { ...assumptions, revenue_streams: a.revenueStreams, cost_assumptions: a.costAssumptions,
      working_capital: a.workingCapital, loan_impact: a.loanImpact };
    values.deal_proceeds_items = startupFixture.useOfProceeds;
  }
  const result = { data: values[table] ?? null,error:null };
  const q:any = { insert:(row:any)=>{writeTables.push(table);if(table==="buddy_validation_reports")savedReports.push(row);return q;}, select:()=>q,eq:()=>q,neq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>result,single:async()=>result,
    then:(resolve:any)=>Promise.resolve(result).then(resolve) }; return q;
} };
require.cache[require.resolve("../../supabase/admin")] = { exports:{supabaseAdmin:()=>client},loaded:true } as any;
require.cache[require.resolve("../../classicSpread/classicSpreadLoader")] = {exports:{loadClassicSpreadData:async()=>({dealId:"deal-1",periods:[],incomeStatement:[],balanceSheet:[]})},loaded:true} as any;
const {computePackageFinancialOutput,computePackageFinancialModel}=require("../packageFinancialComputation") as typeof import("../packageFinancialComputation");

test("the existing model and projection calculators produce one complete saved-output payload",async()=>{
  const result=await computePackageFinancialOutput("deal-1","bank-1");
  assert.equal(result.ok,true);
  if(!result.ok) return;
  const out=result.output;
  assert.equal(out.baseYear.revenue,2400000);
  assert.equal(out.globalCashFlow.globalDSCR, null, "no guarantor schedules cannot become zero coverage");
  assert.equal(out.globalCashFlow.evidenceStatus, "needs_information");
  assert.equal(out.baseYear.ebitda,360000);
  assert.equal(out.baseYear.totalDebtService,120000);
  assert.equal(out.balanceSheetProjections[0].totalAssets,1680000);
  assert.equal(out.memoFinancial.cashFlowAvailable.value,out.projectionModel.annualProjections[0].ebitda);
  assert.equal(out.memoFinancial.annualDebtService.value,out.projectionModel.annualProjections[0].totalDebtService);
  assert.equal(out.memoFinancial.dscrGlobal.value,out.projectionModel.annualProjections[0].dscr);
  assert.equal(out.fundingMetrics.totalProjectCost.value,out.sourcesAndUses.totalUses);
  assert.equal(out.debtCoverageRows[0].cash_flow_available,360000);
  assert.ok(reads>0);
});


test("historical presentation cannot contradict the authoritative period",async()=>{
  const { assertPackageHistoricalConsistency } = await import("../packageHistoricalConsistency");
  const model = buildFinancialModel("deal-1",facts);
  const period=model.periods.find(p=>p.type==="FYE")!;
  const input:any={periods:[{date:period.periodEnd,months:12}],incomeStatement:[{label:"EBITDA",values:[period.cashflow.ebitda]}],balanceSheet:[]};
  assert.doesNotThrow(()=>assertPackageHistoricalConsistency(model,input));
  input.incomeStatement[0].values[0]+=1000;
  assert.throws(()=>assertPackageHistoricalConsistency(model,input),/source conflict/);
});

test("balanced omitted assets and liabilities cannot disappear from the opening source totals", async () => {
  // These two omissions cancel in A=L+E, so arithmetic alone would pass.
  facts = facts.map((fact:any) => ["TOTAL_ASSETS", "SL_TOTAL_ASSETS", "TOTAL_LIABILITIES", "SL_TOTAL_LIABILITIES"].includes(fact.fact_key)
    ? { ...fact, fact_value_num: fact.fact_value_num + 50000 } : fact);
  await assert.rejects(computePackageFinancialOutput("deal-1", "bank-1"), /opening balance sheet needs asset, liability and equity details/);
});

const historicalFixture = JSON.parse(JSON.stringify(facts));
function openingFacts() {
  return Object.entries({ CASH_AND_EQUIVALENTS:250000, TOTAL_ASSETS:250000, TOTAL_LIABILITIES:0, TOTAL_EQUITY:250000, COMMON_STOCK:250000 }).map(([fact_key,fact_value_num])=>({
    fact_type:"BALANCE_SHEET", fact_key, fact_value_num, fact_period_end:"2026-09-21", is_superseded:false, resolution_status:"inferred", owner_type:"DEAL", confidence:1,
  }));
}
test.afterEach(()=>{
  assert.deepEqual(writeTables.filter(table=>table!=="buddy_validation_reports"),[],"read-only engine computation cannot insert snapshots or telemetry");
  startupFixture=null; facts=structuredClone(historicalFixture); stage=null; reportStatus="PASS"; savedReports=[]; writeTables=[]; assumptions.status="confirmed";
});

test("startup uses an interim opening statement and the real calculator without inventing historical earnings",async()=>{
  facts=openingFacts(); stage="The business is preparing to open";
  const result=await computePackageFinancialOutput("deal-1","bank-1");
  assert.equal(result.ok,true); if(!result.ok)return;
  assert.equal(result.output.isNewBusiness,true);
  assert.equal(result.output.globalCashFlow.businessBasis, "projected_year_1");
  assert.equal(result.output.globalCashFlow.businessEbitda, result.output.projectionModel.annualProjections[0].ebitda);
  assert.equal(result.output.globalCashFlow.globalDSCR, null);
  const { checkSpreadPreflight } = await import("../../spreads/preflight/spreadPreflightPure");
  const input = result.output.spreadInput;
  assert.equal(input.balanceSheet.length, 0, "reproduces the real interim loader output");
  assert.equal(input.incomeStatement.length, 0, "never backfill forecast into history");
  assert.equal(checkSpreadPreflight({ balanceSheetRowCount: 0, incomeStatementRowCount: 0,
    sourceDocuments: [], startup: input.startup }).status, "ok");
  assert.deepEqual(input.startup?.projections, result.output.projectionModel.annualProjections);
  assert.deepEqual(input.startup?.openingBalance, result.output.openingBalance);
  assert.equal(result.output.baseYear.label,"Pre-opening");
  assert.equal(result.output.openingBalance?.cash,250000);
  assert.equal(result.output.balanceSheetProjections[0].cash,250000);
  assert.equal(result.output.historicalModel.periods[0].income.revenue,undefined);
  assert.equal(result.output.debtCoverageRows[0].revenue,null);
  assert.ok(result.output.projectionModel.annualProjections[0].revenue>0);
  assert.equal(facts.some((f:any)=>f.fact_key==="TOTAL_REVENUE"),false);
});

test("owner tax income never becomes operating history for an unopened business",async()=>{
  stage="The business is preparing to open";
  const personal=[2023,2024,2025].flatMap(year=>[
    {fact_key:"TAXABLE_INCOME",fact_value_num:58275+(year-2023)*3000},
    {fact_key:"ADJUSTED_GROSS_INCOME",fact_value_num:72000+(year-2023)*3000},
  ].map(row=>({...row,fact_type:"PERSONAL_INCOME",fact_period_end:`${year}-12-31`,owner_type:"PERSONAL",source_canonical_type:"PERSONAL_TAX_RETURN",confidence:1,is_superseded:false,resolution_status:"inferred"})));
  facts=[...openingFacts(),...personal];
  const before=structuredClone(facts);
  const result=await computePackageFinancialOutput("deal-1","bank-1");
  assert.equal(result.ok,true);if(!result.ok)return;
  assert.deepEqual(result.output.historicalModel.periods.map(p=>p.periodEnd),["2026-09-21"]);
  assert.equal(result.output.baseYear.revenue,0);
  assert.equal(result.output.openingBalance?.cash,250000);
  assert.ok(result.output.projectionModel.annualProjections[0].revenue>0);
  assert.deepEqual(facts,before,"personal evidence must stay intact for guarantor review");
});

test("personal returns cannot override an established business's income or balance sheet",async()=>{
  const baseline=await computePackageFinancialOutput("deal-1","bank-1");
  assert.equal(baseline.ok,true);if(!baseline.ok)return;
  facts=[...facts,
    {fact_type:"TAX_RETURN",fact_key:"NET_INCOME",fact_value_num:9000000,fact_period_end:"2025-12-31",owner_type:"DEAL",source_canonical_type:"FORM_1040",confidence:1},
    {fact_type:"BALANCE_SHEET",fact_key:"TOTAL_ASSETS",fact_value_num:8000000,fact_period_end:"2025-12-31",owner_type:"PERSONAL",confidence:1},
    {fact_type:"PERSONAL_INCOME",fact_key:"TAXABLE_INCOME",fact_value_num:7000000,fact_period_end:"2026-12-31",confidence:1},
  ];
  const result=await computePackageFinancialOutput("deal-1","bank-1");
  assert.equal(result.ok,true);if(!result.ok)return;
  assert.deepEqual(result.output.historicalModel,baseline.output.historicalModel);
  assert.deepEqual(result.output.computedMetrics,baseline.output.computedMetrics);
});
test("model computation can precede validation, but artifact-facing admission still rejects FAIL",async()=>{
  facts=openingFacts(); stage="The business is preparing to open"; reportStatus="FAIL";
  assert.equal((await computePackageFinancialOutput("deal-1","bank-1")).ok,false);
  assert.equal((await computePackageFinancialModel("deal-1","bank-1")).ok,true);
});
test("missing operating history alone never establishes startup status",async()=>{
  facts=openingFacts();
  await assert.rejects(computePackageFinancialOutput("deal-1","bank-1"),/established business needs/);
});
test("startup declaration conflicting with operating results fails closed",async()=>{
  stage="The business is preparing to open";
  await assert.rejects(computePackageFinancialOutput("deal-1","bank-1"),/conflicts with operating history/);
});
test("startup requires documented opening cash instead of defaulting it to zero",async()=>{
  facts=openingFacts().filter((f:any)=>f.fact_key!=="CASH_AND_EQUIVALENTS"); stage="The business is preparing to open";
  await assert.rejects(computePackageFinancialOutput("deal-1","bank-1"),/opening balance sheet/);
});

test("real startup validator clears the historical-data deadlock and admits the same financial output",async()=>{
  facts=openingFacts(); stage="The business is preparing to open"; reportStatus="FAIL";
  const {runBuddyValidationPass}=require("../../validation/buddyValidationPass");
  const before=JSON.stringify(facts);
  const report=await runBuddyValidationPass("deal-1");
  assert.equal(report.overallStatus,"PASS_WITH_FLAGS",JSON.stringify(report.checks));
  assert.equal(report.gatingDecision,"ALLOW_GENERATION");
  assert.equal(JSON.stringify(facts),before,"forecasts must never overwrite document facts");
  const output=await computePackageFinancialOutput("deal-1","bank-1");
  assert.equal(output.ok,true);
  assert.equal(savedReports.length,1);
  await runBuddyValidationPass("deal-1");
  assert.equal(savedReports.length,1,"same evidence reuses the latest report");
  assumptions.status="draft";
  assert.equal((await runBuddyValidationPass("deal-1")).overallStatus,"FAIL");
  assert.equal(savedReports.length,2,"changed assumptions invalidate a previous PASS");
  assert.equal((await computePackageFinancialOutput("deal-1","bank-1")).ok,false);
});
test("real startup validator retains blocking opening-balance inconsistencies",async()=>{
  facts=openingFacts(); stage="The business is preparing to open";
  facts.find((f:any)=>f.fact_key==="TOTAL_ASSETS").fact_value_num=300000;
  const {runBuddyValidationPass}=require("../../validation/buddyValidationPass");
  const report=await runBuddyValidationPass("deal-1");
  assert.equal(report.overallStatus,"FAIL");
  assert.ok(report.checks.some((c:any)=>c.status==="BLOCK"&&/imbalance/.test(c.message)));
});

test("package coverage warning includes later downside years without changing projection calculations", async () => {
  facts = openingFacts(); stage = "The business is preparing to open"; startupFixture = projectionFixture();
  const result = await computePackageFinancialOutput("deal-1", "bank-1");
  assert.equal(result.ok, true); if (!result.ok) return;
  const output = result.output;
  const downside = output.projectionModel.sensitivityScenarios.find(s => s.name === "downside")!;
  assert.deepEqual([downside.dscrYear1, downside.dscrYear2, downside.dscrYear3].map(v => Number(v.toFixed(2))), [1.44, .74, .08]);
  assert.ok([output.dscrYear1Base, output.dscrYear2Base, output.dscrYear3Base, output.dscrYear1Downside].every(v => v >= output.projectedDscrThreshold));
  assert.equal(output.dscrBelowThreshold, true, "later-year failure must activate the package warning");
});
