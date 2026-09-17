import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import { buildFinancialModel } from "../buildFinancialModel";
import { renderFromFinancialModel } from "../renderer/v2Adapter";
mockServerOnly();
const require = createRequire(import.meta.url);
const facts = JSON.parse(readFileSync("src/lib/modelEngine/__tests__/packageFinancialFacts.fixture.json", "utf8"));
let reads = 0;
const assumptions = {
  id: "assumptions-1", status: "confirmed", confirmed_at: "2026-09-17T00:00:00Z",
  revenue_streams: [{ id: "r1", name: "Manufacturing", pricingModel: "flat", baseAnnualRevenue: 2400000, growthRateYear1: .1, growthRateYear2: .1, growthRateYear3: .1, seasonalityProfile: null }],
  cost_assumptions: { cogsPercentYear1: .55, cogsPercentYear2: .55, cogsPercentYear3: .55,
    fixedCostCategories: [{ id:"w",name:"Payroll",annualAmount:600000,growthRate:.03 }], plannedHires: [], plannedCapex: [] },
  working_capital: { targetDSO: 42,targetDPO:30,inventoryTurns:6 },
  loan_impact: { loanAmount:1000000,termMonths:120,interestRate:.105,existingDebt:[],equityInjectionAmount:0,equityInjectionSource:"cash_savings",sellerFinancingAmount:0,sellerFinancingTermMonths:0,sellerFinancingRate:0,otherSources:[] },
  management_team: [{ name:"Test Owner",title:"President",yearsInIndustry:17,bio:"Seventeen years of manufacturing management experience." }],
};
const client = { from(table: string) {
  reads++;
  const values: Record<string,unknown> = { buddy_validation_reports:{overall_status:"PASS"}, buddy_sba_assumptions:assumptions,
    deals:{name:"Synthetic Manufacturer",bank_id:"bank-1",deal_type:"SBA",loan_amount:1000000},
    deal_proceeds_items:[{category:"equipment",description:"Equipment",amount:1000000}],buddy_guarantor_cashflow:[],deal_ownership_entities:[],deal_ownership_interests:[] };
  const result = { data: values[table] ?? null,error:null };
  const q:any = { select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>result,single:async()=>result,
    then:(resolve:any)=>Promise.resolve(result).then(resolve) }; return q;
} };
require.cache[require.resolve("../../supabase/admin")] = { exports:{supabaseAdmin:()=>client},loaded:true } as any;
require.cache[require.resolve("../engineAuthority")] = { exports:{computeAuthoritativeEngine:async()=>{
  const financialModel=buildFinancialModel("deal-1",facts);
  return {financialModel,viewModel:renderFromFinancialModel(financialModel,"deal-1"),computedMetrics:{},riskFlags:[],facts};
}},loaded:true } as any;
require.cache[require.resolve("../../classicSpread/classicSpreadLoader")] = {exports:{loadClassicSpreadData:async()=>({dealId:"deal-1",periods:[],incomeStatement:[],balanceSheet:[]})},loaded:true} as any;
const {computePackageFinancialOutput}=require("../packageFinancialComputation") as typeof import("../packageFinancialComputation");

test("the existing model and projection calculators produce one complete saved-output payload",async()=>{
  const result=await computePackageFinancialOutput("deal-1","bank-1");
  assert.equal(result.ok,true);
  if(!result.ok) return;
  const out=result.output;
  assert.equal(out.baseYear.revenue,2400000);
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
