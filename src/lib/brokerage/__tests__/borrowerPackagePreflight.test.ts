import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const stub = (path: string, exports: object) => { require.cache[require.resolve(path)] = {exports,loaded:true} as any; };
const costs = [{category:"equipment",amount:300000,description:"Equipment"}];
let saved: unknown, canonical: unknown, failure: string, changed: boolean, reads: number, modelCalls: number, checks: number, readError: boolean;
stub("@/lib/supabase/admin",{supabaseAdmin:()=>({from(table:string){
  assert.ok(["deals","deal_loan_requests","deal_proceeds_items"].includes(table));
  const filters: Record<string,unknown> = {};
  const q:any={select:()=>q,eq:(k:string,v:unknown)=>{filters[k]=v;return q;},order:()=>q,limit:()=>q,maybeSingle:()=>q,
    then:(resolve:any)=>{
      if (table === "deals") {
        assert.equal(filters.id,"deal");assert.equal(filters.bank_id,"bank");
        return Promise.resolve({data:{id:"deal"},error:null}).then(resolve);
      }
      assert.equal(filters.deal_id,"deal");
      if(table==="deal_loan_requests") assert.equal(filters.bank_id,"bank");
      return Promise.resolve({data:table==="deal_loan_requests"?{use_of_proceeds:saved}:canonical,error:readError?{message:"private-database-error"}:null}).then(resolve);
    }};
  // No write, RPC, storage or network methods exist on this client.
  return q;
}})});
stub("../trident/tridentInputSnapshot",{computeTridentInputSnapshot:async()=>({inputHash: changed && reads++>0 ? "changed" : "initial"})});
stub("@/lib/modelEngine/packageFinancialSnapshot",{previewPackageFinancialSnapshot:async(args:any)=>{
  assert.deepEqual(args,{dealId:"deal",bankId:"bank"});modelCalls++;return {id:"preview",...args};
}});
stub("../trident/packagePreflight",{assertPackageDeterministicReadiness:async(snapshot:any)=>{
  assert.equal(snapshot.id,"preview");checks++;if(failure)throw new Error(failure);
}});
const {checkBorrowerPackageEvidence,samePackageProceeds}=require("../borrowerPackagePreflight") as typeof import("../borrowerPackagePreflight");
test.beforeEach(()=>{saved=structuredClone(costs);canonical=structuredClone(costs);failure="";changed=false;reads=0;modelCalls=0;checks=0;readError=false;});
test("read-only evidence check runs existing canonical model and deterministic preflight",async()=>{
  const result=await checkBorrowerPackageEvidence("deal","bank",true);
  assert.equal(result.status,"passed");assert.equal(modelCalls,1);assert.equal(checks,1);
  assert.match(result.message,/have not been verified/);
  assert.deepEqual(Object.keys(result).sort(),["checkedAt","message","recoveryItems","status"]);
});
test("stale canonical costs cannot give a false pass for newer borrower answers",async()=>{
  saved=[{...costs[0],amount:400000}];
  assert.equal((await checkBorrowerPackageEvidence("deal","bank",false)).status,"not_checked");
  assert.equal(modelCalls,0);assert.equal(checks,0);
});
test("concurrent edits invalidate a completed check",async()=>{
  changed=true;
  assert.equal((await checkBorrowerPackageEvidence("deal","bank",false)).status,"not_checked");
  assert.equal(checks,1);
});
test("failed reads and arbitrary internal errors never pass or expose private details",async()=>{
  readError=true;
  let result=await checkBorrowerPackageEvidence("deal","bank",false);
  assert.equal(result.status,"blocked");assert.equal(modelCalls,0);
  assert.doesNotMatch(JSON.stringify(result),/private-database/);
  readError=false;failure="private-storage-key financial_input_required";
  result=await checkBorrowerPackageEvidence("deal","bank",false);
  assert.equal(result.status,"blocked");assert.doesNotMatch(JSON.stringify(result),/private-storage/);
});
test("known evidence failure returns allowlisted recovery without raw underwriting data",async()=>{
  failure="private-memo-data feasibility_data_completeness_below_70_percent";
  const result=await checkBorrowerPackageEvidence("deal","bank",true);
  assert.equal(result.status,"blocked");assert.ok(result.recoveryItems.length);
  assert.doesNotMatch(JSON.stringify(result),/private-memo-data/);
});
test("genuine business-stage conflict explains the correction without exposing financial data",async()=>{
  failure="financial_input_required: your preparing-to-open answer conflicts with operating history private-financial-details";
  const result=await checkBorrowerPackageEvidence("deal","bank",true);
  assert.equal(result.status,"blocked");
  assert.match(result.message,/Personal tax returns do not establish business operating history/);
  assert.equal(result.recoveryItems[0].questionId,"B07");
  assert.doesNotMatch(JSON.stringify(result),/private-financial-details/);
});
test("proceeds comparison handles ordering and numeric database values but checks every line",()=>{
  assert.equal(samePackageProceeds(costs,[{...costs[0],amount:"300000"}]),true);
  assert.equal(samePackageProceeds(null,costs),true);
  assert.equal(samePackageProceeds([],costs),true);
  assert.equal(samePackageProceeds(costs,[]),false);
  assert.equal(samePackageProceeds(costs,[{...costs[0],category:"working_capital"}]),false);
  assert.equal(samePackageProceeds(costs,[{...costs[0],description:"Changed"}]),false);
  assert.equal(samePackageProceeds(costs,[costs[0],costs[0]]),false);
  assert.equal(samePackageProceeds("malformed",costs),false);
});
