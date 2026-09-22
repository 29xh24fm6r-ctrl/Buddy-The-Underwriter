import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import { feasibilityCompletenessBlocker } from "../feasibilityCompleteness";
mockServerOnly();
const require = createRequire(import.meta.url);
function stub(module: string, exports: object) { require.cache[require.resolve(module)] = { exports, loaded: true } as any; }
let paid = 0;
let writes = 0;
const forbidden = () => { paid++; throw new Error("Model calls forbidden"); };
stub("../feasibilityNarrative", { generateFeasibilityNarratives: forbidden });
stub("../feasibilityRenderer", { renderFeasibilityPDF: () => { writes++; throw new Error("No rendering in preflight"); } });
stub("@/lib/sba/packageBorrowerContext", { loadPackageBorrowerContext: async () => ({ name:"Synthetic QA",city:"Flowery Branch",state:"GA",naics:"722515",industry:"Coffee",franchiseDeclared:true }) });
stub("@/lib/sba/sbaResearchExtractor", { extractResearchForBusinessPlan: async () => ({}) });
stub("../bieMarketExtractor", { extractBIEMarketData: async () => null });
const rows: Record<string, any> = {
  deals:{id:"deal",bank_id:"bank"}, buddy_sba_assumptions:{ management_team:[{name:"QA owner",yearsInIndustry:5,bio:"Synthetic manager"}] },
  deal_ownership_entities:[],buddy_guarantor_cashflow:[],deal_franchises:null,deal_financial_facts:[],deal_loan_requests:null,
};
stub("@/lib/supabase/admin", { supabaseAdmin: () => ({ from(table: string) {
  assert.ok(table in rows, `Unexpected preflight table ${table}`);
  const q:any = { select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,maybeSingle:()=>q,
    then:(resolve:any)=>Promise.resolve({data:rows[table],error:null}).then(resolve),
    insert:()=>{writes++;throw new Error("Preflight must not save");} };
  return q;
} }) });
const { generateFeasibilityStudy } = require("../feasibilityEngine") as typeof import("../feasibilityEngine");
const snapshot:any = {id:"snapshot",dealId:"deal",bankId:"bank",output:{ assumptionsId:"a", projectionModel:{ annualProjections:[], sensitivityScenarios:[], breakEven:{} }, sourcesAndUses:{}, useOfProceeds:[], balanceSheetProjections:[], globalCashFlow:{}, newBusinessAssessment:{flags:{isNewBusiness:true,blockers:[],warnings:[]}} }};
test("real feasibility analyses identify evidence gaps before any model, renderer or write",async()=>{
  const result=await generateFeasibilityStudy({dealId:"deal",bankId:"bank",preflightSnapshot:snapshot});
  assert.equal(result.ok,false);
  assert.match(result.error!,/feasibility_data_completeness_below_70_percent/);
  assert.ok(result.composite!.missingEvidence.length > 0);
  assert.equal(paid,0);assert.equal(writes,0);
});
test("preflight refuses a financial snapshot from a different tenant", async()=>{
  await assert.rejects(generateFeasibilityStudy({dealId:"deal",bankId:"bank",preflightSnapshot:{...snapshot,bankId:"other"}}),/deal_mismatch/);
  assert.equal(paid,0);
});
test("publication and preflight use one threshold including percentage-form input",()=>{
  for(const n of [0,.5,50,69,NaN,Infinity,101]) assert.ok(feasibilityCompletenessBlocker(n,["market_demand.demandTrend"]), String(n));
  for(const n of [.7,.9,1,70,100]) assert.equal(feasibilityCompletenessBlocker(n,[]),null,String(n));
});
