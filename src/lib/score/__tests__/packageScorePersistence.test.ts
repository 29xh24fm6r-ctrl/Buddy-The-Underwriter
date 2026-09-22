import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const inputPath = require.resolve("../inputs");
let evidenceSeen: any;
require.cache[inputPath] = { id: inputPath, filename: inputPath, loaded: true, exports: {
  loadScoreInputs: async (args: any) => {
    evidenceSeen = args.packageEvidence;
    return { dealId: "deal", bankId: "bank", businessEntityType: "nonprofit", riskProfile: { hardBlockers: ["test ineligible"] },
      snapshot: {}, missingInputs: [], applicants: [], isFranchise: false, useOfProceeds: [], };
  },
} } as any;
const { computeBuddySBAScore } = require("../buddySbaScore") as typeof import("../buddySbaScore");
test("a finalized package retry reuses identical evidence; a new bundle cannot reuse its score", async () => {
  let active: any = null; let writes = 0;
  const sb: any = { from: () => { const q: any = { select: () => q, eq: () => q, is: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => ({ data: active, error: null }) }; return q; },
    rpc: async (_name: string, args: any) => { writes++; active = { ...args.p_payload, id: `score-${writes}` }; return { data: active.id, error: null }; },
  };
  const packageEvidence = { bankId: "bank", packageId: "p1", feasibilityId: "f1", bundleId: "b1", inputHash: "h1" };
  const first = await computeBuddySBAScore({ sb, dealId: "deal", context: "package_seal", packageEvidence });
  assert.equal(first.eligibilityPassed, false); assert.equal(first.score, 0);
  assert.deepEqual(evidenceSeen, packageEvidence);
  active.score_status = "locked";
  const retry = await computeBuddySBAScore({ sb, dealId: "deal", context: "package_seal", packageEvidence });
  assert.equal(retry.id, first.id); assert.equal(writes, 1);
  const next = await computeBuddySBAScore({ sb, dealId: "deal", context: "package_seal", packageEvidence: { ...packageEvidence, bundleId: "b2", inputHash: "h2" } });
  assert.notEqual(next.id, first.id); assert.equal(writes, 2);
});
