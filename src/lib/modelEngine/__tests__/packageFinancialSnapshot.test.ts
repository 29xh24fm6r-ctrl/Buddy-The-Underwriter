import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import { deterministicHash } from "../hashing";
mockServerOnly();
const require = createRequire(import.meta.url);
let saved: any = null;
let computations = 0;
let memoBuilds = 0;
let inputHash = "input-1";
let memoPersist: boolean | undefined;
const sb = { from(table: string) {
  const filters: Record<string, unknown> = {};
  let inserted: any;
  const finish = async () => {
    if (table === "deals") return { data: { bank_id: "bank-1" }, error: null };
    if (inserted) saved = { id: "financial-1", ...structuredClone(inserted) };
    const data = saved && Object.entries(filters).every(([key,value]) => saved[key] === value) ? structuredClone(saved) : null;
    return { data, error: null };
  };
  const q: any = { select: () => q, eq: (key: string,value: unknown) => { filters[key]=value; return q; },
    insert: (value: any) => { inserted=value; return q; }, single: finish, maybeSingle: finish };
  return q;
} };
require.cache[require.resolve("../../supabase/admin")] = {exports:{supabaseAdmin:()=>sb},loaded:true} as any;
require.cache[require.resolve("../packageFinancialComputation")] = {exports:{computePackageFinancialOutput:async()=>{
  computations++;return {ok:true,output:{computedMetrics:{revenue:100},historicalModel:{periods:[]},riskFlags:[],projectionModel:{annualProjections:[{revenue:110}]}}};
}},loaded:true} as any;
require.cache[require.resolve("../../brokerage/trident/tridentInputSnapshot")] = {exports:{computeTridentInputSnapshot:async()=>({inputHash})},loaded:true} as any;
require.cache[require.resolve("../../creditMemo/canonical/buildCanonicalCreditMemo")] = {exports:{buildCanonicalCreditMemo:async(args:any)=>{
  memoBuilds++;assert.equal(args.financialOutput.projectionModel.annualProjections[0].revenue,110);
  memoPersist=args.persistDerived;
  return {ok:true,memo:{version:"canonical_v1",financial_analysis:{revenue:110}},contractBlockers:[]};
}},loaded:true} as any;
const {preparePackageFinancialSnapshot,loadPackageFinancialSnapshot,previewPackageFinancialSnapshot}=require("../packageFinancialSnapshot") as typeof import("../packageFinancialSnapshot");

test("one persisted output contains memo tables, is reused, and rejects tampering or another deal",async()=>{
  const first=await preparePackageFinancialSnapshot({dealId:"deal-1",bankId:"bank-1",inputHash});
  const second=await preparePackageFinancialSnapshot({dealId:"deal-1",bankId:"bank-1",inputHash});
  assert.equal(first.id,second.id);assert.equal(computations,1);assert.equal(memoBuilds,1);
  assert.equal(memoPersist,true);
  assert.deepEqual(first.output.canonicalMemo,saved.package_output.canonicalMemo);
  await assert.rejects(loadPackageFinancialSnapshot({dealId:"other-deal",bankId:"bank-1",snapshotId:first.id}),/financial_snapshot_missing/);
  saved.package_output.projectionModel.annualProjections[0].revenue=999;
  await assert.rejects(loadPackageFinancialSnapshot({dealId:"deal-1",bankId:"bank-1",snapshotId:first.id}),/financial_snapshot_invalid/);
  inputHash="input-2";
  await assert.rejects(preparePackageFinancialSnapshot({dealId:"deal-1",bankId:"bank-1",inputHash:"input-1"}),/input_snapshot_changed/);
});

test("preview recomputes current canonical output without saving or reusing a persisted verdict",async()=>{
  const previous = structuredClone(saved);
  const count = computations;
  const preview = await previewPackageFinancialSnapshot({dealId:"deal-1",bankId:"bank-1"});
  assert.match(preview.id,/^preview:/);
  assert.equal(computations,count+1);
  assert.equal(memoPersist,false);
  assert.equal(preview.output.projectionModel.annualProjections[0].revenue,110);
  assert.deepEqual(saved,previous);
  await assert.rejects(previewPackageFinancialSnapshot({dealId:"deal-1",bankId:"other-bank"}),/deal_mismatch/);
  assert.equal(computations,count+1);
});

test("snapshots from before the business-fact scope repair cannot be loaded or reused",async()=>{
  await preparePackageFinancialSnapshot({dealId:"deal-1",bankId:"bank-1",inputHash});
  saved.model_version="model_v2_package_3";
  saved.package_input_hash=deterministicHash({inputHash,version:"model_v2_package_3"});
  await assert.rejects(loadPackageFinancialSnapshot({dealId:"deal-1",bankId:"bank-1",snapshotId:saved.id}),/financial_snapshot_invalid/);
  const count=computations;
  await preparePackageFinancialSnapshot({dealId:"deal-1",bankId:"bank-1",inputHash});
  assert.equal(computations,count+1,"same source evidence must recompute under the corrected model");
  assert.equal(saved.model_version,"model_v2_package_4");
});
