import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
let writes = 0;
require.cache[require.resolve("@/lib/supabase/admin")] = {loaded:true,exports:{supabaseAdmin:()=>({from(table:string){
  assert.equal(table,"buddy_covenant_packages");
  return {insert:async()=>{writes++;return {error:null};}};
}})}} as any;
const {buildCovenantPackage}=require("@/lib/covenants/covenantPackageBuilder") as typeof import("@/lib/covenants/covenantPackageBuilder");
test("diagnostic covenants use the same governed thresholds without saving a machine draft",async()=>{
  const input={dealId:"deal",riskGrade:"3",governedDscrFloor:1.25,dealType:"operating_company" as const,
    actualDscr:1.4,actualLeverage:2,actualDebtYield:null,actualOccupancy:null,actualGlobalCashFlow:200000,loanAmount:300000};
  const preview=await buildCovenantPackage(input,{persist:false});
  assert.equal(writes,0);
  const saved=await buildCovenantPackage(input);
  assert.equal(writes,1);
  const withoutIds = (rows: Array<{ id: string }>) => rows.map(row=>({...row,id:undefined}));
  assert.deepEqual(withoutIds(preview.financial),withoutIds(saved.financial));
  assert.deepEqual(withoutIds(preview.reporting),withoutIds(saved.reporting));
  assert.equal(preview.financial.find(row=>row.category === "dscr")?.threshold,1.25);
  assert.equal(preview.rationale,saved.rationale);
});
