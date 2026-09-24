import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { mockServerOnly } from "../../../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
let checklistOk = false;
const saved: any[] = [];
function stub(path: string, exports: any) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports: { __esModule: true, ...exports } } as any;
}
stub("@/lib/brokerage/session", { getBorrowerSessionFromRequest: async () => ({ deal_id: "deal", bank_id: "bank", tokenHash: "hash" }) });
stub("@/lib/brokerage/rateLimits", { checkConciergeRateLimit: async () => ({ allowed: true }) });
stub("@/lib/franchise/seedFranchiseChecklist", { seedFranchiseChecklist: async (_: unknown, params: any) => {
  assert.deepEqual(params, { dealId: "deal", bankId: "bank", brandName: "7 BREW" }); return { ok: checklistOk };
} });
stub("@/lib/supabase/admin", { supabaseAdmin: () => ({ from(table: string) {
  const q: any = { select: () => q, eq: () => q,
    maybeSingle: async () => ({ data: { id: "brand", brand_name: "7 BREW" }, error: null }),
    upsert: async (row: any) => { assert.equal(table, "deal_franchises"); saved.push(row); return { error: null }; },
    insert: async () => ({ error: null }),
  }; return q;
} }) });
const { PATCH } = require("../route");
test("partial checklist failure returns a retryable result and same-brand retry completes", async () => {
  const request = () => new NextRequest("https://example.test/api/brokerage/franchise", { method: "PATCH", body: JSON.stringify({ brand_id: "brand" }), headers: { "content-type": "application/json" } });
  const partial = await PATCH(request());
  assert.equal(partial.status, 503);
  assert.deepEqual(await partial.json(), { ok: false, error: "franchise_checklist_unavailable", selectionSaved: true });
  checklistOk = true;
  const retried = await PATCH(request());
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).ok, true);
  assert.ok(saved.every(row => row.deal_id === "deal" && row.brand_id === "brand"));
});
