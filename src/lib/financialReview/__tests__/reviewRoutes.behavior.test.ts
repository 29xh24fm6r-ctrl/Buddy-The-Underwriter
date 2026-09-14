import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { validateResolutionInput } from "../validateResolutionInput";

const saved = new Map<string, NodeModule | undefined>();
function stub(name: string, exports: unknown) {
  const id = require.resolve(name);
  saved.set(id,require.cache[id]);
  require.cache[id] = { id, filename:id, loaded:true, exports, children:[], paths:[] } as unknown as NodeModule;
}
let allowed = true;
let rpcData: any;
let rpcError: any;
let calls: any[] = [];
let reads: Array<{table:string; filters:Record<string,unknown>}> = [];
let canonical: typeof import("@/app/api/deals/[dealId]/financial-review/resolve/route").POST;
let legacy: typeof import("@/app/api/deals/[dealId]/financial-validation/[factId]/route").POST;
let gaps: typeof import("@/app/api/deals/[dealId]/gap-queue/resolve/route").POST;
before(() => {
  stub("server-only",{});
  stub("@/lib/auth/requireDealCockpitAccess",{
    COCKPIT_ROLES:["banker"],
    requireDealCockpitAccess: async () => allowed ? {ok:true,bankId:"bank",userId:"banker",role:"banker"} : {ok:false,status:403,error:"forbidden"},
  });
  stub("@/lib/supabase/admin",{supabaseAdmin:() => ({
    from(table:string) {
      // Writing anywhere except the shared RPC fails this test immediately.
      const filters:Record<string,unknown> = {};
      reads.push({table,filters});
      const query = {
        select:() => query,
        eq:(key:string,value:unknown) => { filters[key]=value; return query; },
        maybeSingle: async () => ({data:{id:"gap",gap_type:"low_confidence",conflict_id:null},error:null}),
      };
      return query;
    },
    rpc:async (name:string,args:unknown) => { calls.push({name,args}); return {data:rpcData,error:rpcError}; },
  })});
  canonical = require("@/app/api/deals/[dealId]/financial-review/resolve/route").POST;
  legacy = require("@/app/api/deals/[dealId]/financial-validation/[factId]/route").POST;
  gaps = require("@/app/api/deals/[dealId]/gap-queue/resolve/route").POST;
});
after(() => { for(const [id,value] of saved) { if(value) require.cache[id]=value; else delete require.cache[id]; } });
beforeEach(() => {
  allowed=true; calls=[]; reads=[]; rpcError=null;
  rpcData={ok:true,resolution:{gapId:"gap",factId:"fact",resolvedStatus:"resolved_confirmed",resolvedAt:"2026-09-14T00:00:00Z"}};
});
const request = (body:unknown) => new NextRequest("https://buddy.test/api/review",{method:"POST",body:JSON.stringify(body)});
const ctx = {params:Promise.resolve({dealId:"deal",factId:"fact"})};
test("all three endpoints use the canonical review transaction and authenticated scope", async () => {
  for(const [route,body] of [
    [canonical,{gapId:"gap",action:"confirm_value",factId:"fact"}],
    [legacy,{action:"confirm_fact",snapshotId:"obsolete-snapshot"}],
    [gaps,{action:"confirm",factId:"fact"}],
  ] as const) {
    const response = await route(request({...body,dealId:"attack",bankId:"attack",userId:"attack"}),ctx);
    assert.equal(response.status,200);
    assert.equal((await response.json()).ok,true);
  }
  assert.equal(calls.length,3);
  for(const call of calls) {
    assert.equal(call.name,"resolve_canonical_financial_review");
    assert.equal(call.args.p_bank_id,"bank");
    assert.equal(call.args.p_deal_id,"deal");
    assert.equal(call.args.p_actor_user_id,"banker");
  }
  assert.ok(reads.every(r => r.table === "deal_gap_queue" && r.filters.bank_id === "bank" && r.filters.deal_id === "deal"));
});
test("database failures and empty commit responses never become successful review responses", async () => {
  rpcError={message:"audit insert failed"};
  assert.equal((await canonical(request({gapId:"gap",action:"confirm_value",factId:"fact"}),ctx)).status,500);
  rpcError=null; rpcData=null;
  const response = await legacy(request({action:"confirm_fact"}),ctx);
  assert.equal(response.status,400);
  assert.equal((await response.json()).ok,false);
});
test("authorization rejection performs no reads or writes", async () => {
  allowed=false;
  assert.equal((await canonical(request({gapId:"gap",action:"confirm_value",factId:"fact"}),ctx)).status,403);
  assert.deepEqual(reads,[]); assert.deepEqual(calls,[]);
});
test("unknown gap actions fail and zero remains a numeric override", async () => {
  const invalid = await gaps(request({action:"unknown",factId:"fact"}),ctx);
  assert.equal(invalid.status,422);
  const response = await canonical(request({gapId:"gap",action:"override_value",resolvedValue:0,rationale:"Verified using source tax return"}),ctx);
  assert.equal(response.status,200);
  assert.equal(calls[0].args.p_intent.resolvedValue,0);
});
test("numeric coercion, malformed rationale and invented dates are rejected before RPC", async () => {
  for(const resolvedValue of ["", "12junk", "123", null]) {
    const response = await canonical(request({gapId:"gap",action:"override_value",resolvedValue,rationale:"Reviewed against tax return"}),ctx);
    assert.equal(response.status,422);
  }
  assert.equal(calls.length,0);
  assert.ok(validateResolutionInput({gapId:"gap",action:"override_value",resolvedValue:Infinity,rationale:"Reviewed source document"},"low_confidence").length);
  assert.ok(validateResolutionInput({gapId:"gap",action:"override_value",resolvedValue:10,rationale:42 as any},"low_confidence").length);
  for(const date of ["2024-02-30","1900-01-01","not-a-date"]) {
    assert.ok(validateResolutionInput({gapId:"gap",action:"provide_value",resolvedValue:0,rationale:"Reviewed source document",resolvedPeriodStart:date,resolvedPeriodEnd:date},"missing_fact").length);
  }
});
