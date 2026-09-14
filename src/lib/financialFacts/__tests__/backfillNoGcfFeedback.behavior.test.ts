import { before, after, test } from "node:test";
import assert from "node:assert/strict";

const saved = new Map<string, NodeModule | undefined>();
function stub(name:string,exports:unknown) {
  const id=require.resolve(name); saved.set(id,require.cache[id]);
  require.cache[id]={id,filename:id,loaded:true,exports,children:[],paths:[]} as unknown as NodeModule;
}
const reads:string[]=[];
const writes:any[]=[];
let backfill:typeof import("../backfillFromSpreads").backfillCanonicalFactsFromSpreads;
before(() => {
  stub("server-only",{});
  stub("@/lib/financialFacts/writeFact",{MIN_VALID_PERIOD_DATE:"1990-01-01",upsertDealFinancialFact:async (args:unknown) => { writes.push(args); return {ok:true}; }});
  stub("@/lib/supabase/admin",{supabaseAdmin:() => ({
    from(table:string) {
      const filters:Record<string,unknown>={};
      const result=() => {
        if(table==="deals") return {data:{deal_type:"CRE",has_monthly_statements:true},error:null};
        const type=String(filters.spread_type); reads.push(type);
        if(type==="GLOBAL_CASH_FLOW") throw new Error("Rendered GCF must never be read as a fact source");
        const data=type==="T12" ? {spread_version:1,rendered_json:{asOf:"2024-12-31",rows:[
          {key:"TOTAL_INCOME",values:[1000]},{key:"TOTAL_OPEX",values:[400]},{key:"NOI",values:[600]},
        ]}} : null;
        return {data,error:null};
      };
      const query={
        select:() => query,eq:(k:string,v:unknown) => {filters[k]=v;return query;},
        order:() => query,limit:() => query,maybeSingle:async () => result(),
        then:(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown) => Promise.resolve().then(result).then(resolve,reject),
      };
      return query;
    },
  })});
  backfill=require("../backfillFromSpreads").backfillCanonicalFactsFromSpreads;
});
after(() => {for(const [id,value] of saved){if(value)require.cache[id]=value;else delete require.cache[id];}});
test("backfill preserves eligible statement inputs without feeding computed GCF outputs back into facts",async () => {
  const result=await backfill({dealId:"deal",bankId:"bank"});
  assert.equal(result.ok,true);
  assert.ok(reads.includes("T12"));
  assert.ok(!reads.includes("GLOBAL_CASH_FLOW"));
  assert.ok(writes.some(w=>w.factKey==="NOI_TTM" && w.factValueNum===600));
  assert.ok(writes.every(w=>!String(w.provenance.source_ref).includes("GLOBAL_CASH_FLOW")));
  assert.ok(writes.every(w=>!["DSCR","ANNUAL_DEBT_SERVICE","CASH_FLOW_AVAILABLE","GCF_DSCR"].includes(w.factKey)));
});
