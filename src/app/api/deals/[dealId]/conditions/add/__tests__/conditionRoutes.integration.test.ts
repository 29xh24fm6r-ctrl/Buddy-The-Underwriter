import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../../../../test/utils/mockServerOnly";
import { setupConditionDatabase } from "../../../../../../../../test/utils/conditionDatabase";
mockServerOnly();
const require = createRequire(import.meta.url);
let sb: any;
function stub(path: string, exports: any) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports: { __esModule: true, ...exports } } as any;
}
stub("@/lib/server/dealApiContext", { resolveDealApiContext: async () => ({ ok: true, sb, bankId: "bank", actorProfileId: "actor" }) });
stub("@/lib/server/deal-access", { assertDealAccess: async () => undefined });
stub("@/lib/supabase/admin", { supabaseAdmin: () => sb });
const { POST: add } = require("../route");
const { POST: seed } = require("../../../portal/seed-requests/route");
const ctx = { params: Promise.resolve({ dealId: "deal" }) };

test("manual conditions and borrower requests honor live column names, tenant and open status", async () => {
  const fixture = await setupConditionDatabase(); sb = fixture.sb;
  try {
    const response = await add(new Request("https://example.test", { method: "POST", body: JSON.stringify({ title: "Signed lease" }) }), ctx);
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    const bad = await add(new Request("https://example.test", { method: "POST", body: JSON.stringify({ title: "Test", category: "invalid" }) }), ctx);
    assert.equal(bad.status, 400);
    await fixture.db.exec("update deal_conditions set due_date='2026-10-01'; insert into deal_mitigants(deal_id,bank_id,mitigant_label,status) values ('deal','bank','Additional support','open'),('deal','bank','Waived item','waived'),('deal','other-bank','Foreign item','open');");
    const first = await seed(new Request("https://example.test", { method: "POST" }), ctx);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).inserted, 2);
    const rows = (await fixture.db.query<{title:string;due_at:string|null}>("select title,due_at from borrower_document_requests order by title")).rows;
    assert.deepEqual(rows, [{ title: "Additional support", due_at: null }, { title: "Signed lease", due_at: "2026-10-01" }]);
    assert.equal((await (await seed(new Request("https://example.test"),ctx)).json()).inserted, 0);
    fixture.fail("deal_conditions");
    assert.equal((await seed(new Request("https://example.test"),ctx)).status, 503);
  } finally { await fixture.db.close(); }
});
