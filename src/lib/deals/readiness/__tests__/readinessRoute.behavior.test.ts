import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { BuildUnifiedDealReadinessResult } from "../buildUnifiedDealReadiness";

// Exercise the real route response with controlled service results. No database,
// authentication provider, or legacy readiness evaluator may be contacted.
const originalModules = new Map<string, NodeModule | undefined>();
function stub(name: string, exports: unknown) {
  const id = require.resolve(name);
  originalModules.set(id, require.cache[id]);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] } as unknown as NodeModule;
}
let result: BuildUnifiedDealReadinessResult;
let calls: unknown[] = [];
let GET: typeof import("@/app/api/deals/[dealId]/readiness/route").GET;

before(() => {
  stub("@/lib/auth/requireDealAccess", { requireDealAccess: async (id: string) => { assert.equal(id, "deal-test"); } });
  stub("@/lib/deals/readiness/buildUnifiedDealReadiness", {
    buildUnifiedDealReadiness: async (args: unknown) => { calls.push(args); return result; },
  });
  stub("@/lib/deals/readiness", { getDealReadiness: () => { throw new Error("legacy readiness must not run"); } });
  GET = require("@/app/api/deals/[dealId]/readiness/route").GET;
});
after(() => {
  for (const [id, original] of originalModules) {
    if (original) require.cache[id] = original;
    else delete require.cache[id];
  }
});

async function request() {
  calls = [];
  return GET(new Request("http://localhost/api/deals/deal-test/readiness"), { params: Promise.resolve({ dealId: "deal-test" }) });
}

for (const ready of [true, false]) {
  test(`legacy and structured response agree when readiness is ${ready}`, async () => {
    const blockers = ready ? [] : [{ code: "financial_conflict", label: "Resolve financial conflict" }];
    result = { ok: true, bankId: "bank", selfHeal: null, readiness: { ready, blockers } } as BuildUnifiedDealReadinessResult;
    const response = await request();
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ready, ready);
    assert.equal(payload.ready, payload.readiness.ready);
    assert.equal(payload.reason, ready ? null : "Resolve financial conflict");
    assert.deepEqual(calls, [{ dealId: "deal-test", runReconciliation: false, runSelfHeal: false }]);
  });
}

test("a failed readiness evaluation cannot preserve a stale ready=true", async () => {
  result = { ok: false, reason: "memo_input_failed", error: "inputs unavailable" };
  const response = await request();
  const payload = await response.json();
  assert.equal(response.status, 500);
  assert.equal(payload.ok, false);
  assert.equal(payload.ready, false);
  assert.equal(calls.length, 1);
});
