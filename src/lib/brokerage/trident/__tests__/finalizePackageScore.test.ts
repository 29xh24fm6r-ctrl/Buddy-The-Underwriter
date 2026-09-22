import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const riskPath = require.resolve("@/lib/sba/sbaRiskProfile");
require.cache[riskPath] = { id: riskPath, filename: riskPath, loaded: true, exports: {
  buildSBARiskProfile: async () => ({ compositeRiskScore: 50, compositeRiskTier: "medium", industryFactor: { tier: "medium" }, loanTermFactor: { tier: "medium" }, hardBlockers: [] }),
} } as any;
const { loadScoreInputs } = require("@/lib/score/inputs") as typeof import("@/lib/score/inputs");

function database(tables: Record<string, any[]>, failUpdate = false) {
  return { from(table: string) {
    let rows = [...(tables[table] ?? [])]; let patch: any;
    const q: any = {
      select: () => q, eq: (key: string, value: unknown) => { rows = rows.filter(r => r[key] === value); return q; },
      is: (key: string, value: unknown) => { rows = rows.filter(r => (r[key] ?? null) === value); return q; },
      in: (key: string, values: unknown[]) => { rows = rows.filter(r => values.includes(r[key])); return q; },
      order: (key: string) => { rows.sort((a,b) => b[key] - a[key]); return q; },
      limit: (n: number) => { rows = rows.slice(0,n); return q; },
      update: (value: any) => { patch = value; return q; },
      maybeSingle: async () => {
        if (patch && failUpdate) return { data: null, error: { message: "unavailable" } };
        if (patch) rows.forEach(r => Object.assign(r,patch));
        return { data: rows[0] ?? null, error: null };
      },
      then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
    }; return q;
  } } as any;
}
const evidence = { bankId: "bank", packageId: "p1", feasibilityId: "f1", bundleId: "bundle", inputHash: "hash", dealId: "deal" };
test("score reads the exact package and feasibility version, canonical equity, and rejects mismatched evidence", async () => {
  const tables = {
    deals: [{ id: "deal", bank_id: "bank" }],
    buddy_sba_packages: [
      { id: "p1", deal_id: "deal", version_number: 1, dscr_year1_base: 1.5, sources_and_uses: { totalUses: 1000000, equityInjection: { actualAmount: 250000 } } },
      { id: "p2", deal_id: "deal", version_number: 2, dscr_year1_base: 2.5 },
    ],
    buddy_feasibility_studies: [
      { id: "f1", deal_id: "deal", bank_id: "bank", projections_package_id: "p1", version_number: 1, composite_score: 70 },
      { id: "f2", deal_id: "deal", bank_id: "bank", projections_package_id: "p2", version_number: 2, composite_score: 90 },
    ],
  };
  const sb = database(tables);
  const pinned = await loadScoreInputs({ sb, dealId: "deal", packageEvidence: evidence });
  assert.equal(pinned.dscrBase, 1.5); assert.equal(pinned.feasibilityComposite, 70);
  assert.equal(pinned.equityInjectionAmount, 250000); assert.equal(pinned.totalProjectCost, 1000000);
  const latest = await loadScoreInputs({ sb, dealId: "deal" });
  assert.equal(latest.dscrBase, 2.5); assert.equal(latest.feasibilityComposite, 90);
  await assert.rejects(loadScoreInputs({ sb, dealId: "deal", packageEvidence: { ...evidence, bankId: "other" } }), /tenant/);
  await assert.rejects(loadScoreInputs({ sb, dealId: "deal", packageEvidence: { ...evidence, feasibilityId: "f2" } }), /feasibility evidence/);
  await assert.rejects(loadScoreInputs({ sb, dealId: "deal", packageEvidence: { ...evidence, packageId: "absent" } }), /projection evidence/);
});

let computed: any;
const scorePath = require.resolve("@/lib/score/buddySbaScore");
require.cache[scorePath] = { id: scorePath, filename: scorePath, loaded: true, exports: {
  computeBuddySBAScore: async (args: any) => { computed = args; return { id: "score", bankId: "bank", score: 42, eligibilityPassed: false }; },
} } as any;
const { finalizePackageScore } = require("../finalizePackageScore") as typeof import("../finalizePackageScore");
test("finalization locks only its exact score, keeps low/ineligible results, and retries safely", async () => {
  const row = { id: "score", bank_id: "bank", deal_id: "deal", score_status: "draft", score: 42, eligibility_passed: false };
  const sb = database({ buddy_sba_scores: [row] });
  assert.equal(await finalizePackageScore(sb, evidence), "score");
  assert.equal(row.score_status, "locked"); assert.equal(row.score, 42); assert.equal(row.eligibility_passed, false);
  assert.equal(computed.context, "package_seal"); assert.deepEqual(computed.packageEvidence, evidence);
  assert.equal(await finalizePackageScore(sb, evidence), "score");
  await assert.rejects(finalizePackageScore(database({ buddy_sba_scores: [{ ...row, superseded_at: "now" }] }), evidence), /could not be finalized/);
  await assert.rejects(finalizePackageScore(database({ buddy_sba_scores: [row] }, true), evidence), /could not be finalized/);
  await assert.rejects(finalizePackageScore(sb, { ...evidence, packageId: null }), /incomplete/);
});

test("factory finalizes score after release validation and rechecks frozen inputs before publication", () => {
  const source = readFileSync("src/lib/brokerage/trident/tridentFactoryStages.ts", "utf8").split("export async function verifyTridentFactory")[1];
  const score = source.indexOf("await finalizePackageScore");
  assert.ok(score > source.indexOf("gate?.ok !== true"));
  assert.ok(source.indexOf("await assertFrozen(args)", score) < source.indexOf('"finalize_trident_bundle_run"'));
  assert.match(source.slice(0, score), /if \(args.mode === "final"\)/);
});
