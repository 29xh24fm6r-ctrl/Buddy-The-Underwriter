import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const { loadFranchiseScoreEvidence } = require("../franchiseEvidence");
const { hashTridentManifest, TRIDENT_SNAPSHOT_VERSION } = require("../../brokerage/trident/tridentInputSnapshot");

function database(linked = true, errorTable = "") {
  const brand = { id: "brand", unit_count: 500, founding_year: 2010, sba_eligible: true, sba_certification_status: "certified", has_item_19: true };
  const rows: Record<string, unknown> = { deal_franchises: linked ? { brand_id: "brand" } : null, franchise_brands: brand, fdd_item19_facts: [{ percentile_rank: 75 }] };
  const sb = { from(table: string) {
    const filters: Record<string, unknown> = {};
    const result = () => {
      if (table === "deal_franchises") assert.equal(filters.deal_id, "deal");
      if (table === "franchise_brands") assert.equal(filters.id, "brand");
      if (table === "fdd_item19_facts") assert.equal(filters.brand_id, "brand");
      return { data: rows[table], error: errorTable === table ? { message: "unavailable" } : null };
    };
    const q: any = { select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; }, order: () => q, limit: () => q,
      maybeSingle: async () => result(), then: (resolve: any) => Promise.resolve(result()).then(resolve) };
    return q;
  } };
  return { sb, brand };
}

test("explicit franchise link loads scoped reference evidence; no link does not imply eligibility", async () => {
  assert.equal(await loadFranchiseScoreEvidence(database(false).sb, "deal"), null);
  const evidence = await loadFranchiseScoreEvidence(database().sb, "deal");
  assert.equal(evidence.brandId, "brand");
  assert.equal(evidence.sbaEligible, true);
  assert.equal(evidence.item19PercentileRank, 75);
});
test("franchise evidence failures stop scoring instead of silently dropping the franchise", async () => {
  for (const table of ["deal_franchises", "franchise_brands", "fdd_item19_facts"]) {
    await assert.rejects(loadFranchiseScoreEvidence(database(true, table).sb, "deal"), /franchise_evidence_unavailable/);
  }
});
test("brand and certification changes invalidate frozen package evidence", async () => {
  const { sb, brand } = database();
  const hash = (evidence: unknown) => hashTridentManifest({ version: TRIDENT_SNAPSHOT_VERSION, sources: { franchiseEvidence: evidence } });
  const before = hash(await loadFranchiseScoreEvidence(sb, "deal"));
  brand.sba_eligible = false;
  brand.sba_certification_status = "revoked";
  assert.notEqual(hash(await loadFranchiseScoreEvidence(sb, "deal")), before);
  assert.notEqual(hash({ ...(await loadFranchiseScoreEvidence(sb, "deal")), brandId: "different-brand" }), before);
});
