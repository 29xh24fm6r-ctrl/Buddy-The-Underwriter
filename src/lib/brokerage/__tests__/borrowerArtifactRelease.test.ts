import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const { getBorrowerArtifactRelease } = require("../borrowerArtifactRelease") as typeof import("../borrowerArtifactRelease");

function fixture() {
  return {
    marketplace_picks: [{ deal_id: "d", listing_id: "l", claim_id: "c", picked_lender_bank_id: "b", status: "picked", borrower_selected_at: "2026-09-19" }],
    marketplace_claims: [{ id: "c", listing_id: "l", lender_bank_id: "b", status: "active" }],
    marketplace_listings: [{ id: "l", deal_id: "d", sealed_package_id: "s", status: "picked" }],
    marketplace_package_access: [{ deal_id: "d", listing_id: "l", claim_id: "c", lender_bank_id: "b", access_level: "full", revoked_at: null, sealed_package_id: "s" }],
    buddy_sealed_packages: [{ id: "s", deal_id: "d", unsealed_at: null }],
  } as Record<string, Record<string, unknown>[]>;
}
function db(rows: ReturnType<typeof fixture>, fail?: string) {
  return { from(table: string) {
    let found = rows[table] ?? [];
    const q = {
      select: (_: string) => q,
      eq: (key: string, value: unknown) => { found = found.filter(r => r[key] === value); return q; },
      is: (key: string, value: unknown) => q.eq(key, value),
      maybeSingle: async () => ({ data: found.length === 1 ? found[0] : null,
        error: table === fail || found.length > 1 ? { message: "unavailable" } : null }),
    };
    return q;
  } };
}
test("release requires matching bank claim, borrower selection and active bound handoff", async () => {
  assert.equal((await getBorrowerArtifactRelease("d", db(fixture()))).released, true);
  assert.equal((await getBorrowerArtifactRelease("other", db(fixture()))).released, false);
});
for (const table of Object.keys(fixture())) {
  test(`missing ${table} cannot release artifacts`, async () => {
    const rows = fixture(); rows[table] = [];
    assert.equal((await getBorrowerArtifactRelease("d", db(rows))).released, false);
  });
  test(`read error in ${table} fails closed`, async () => {
    const result = await getBorrowerArtifactRelease("d", db(fixture(), table));
    assert.deepEqual(result, { released: false, reason: "state_unavailable" });
  });
}
for (const [table, key, value] of [
  ["marketplace_claims", "lender_bank_id", "wrong"],
  ["marketplace_claims", "listing_id", "wrong"],
  ["marketplace_claims", "status", "withdrawn"],
  ["marketplace_picks", "borrower_selected_at", null],
  ["marketplace_package_access", "sealed_package_id", "wrong"],
  ["marketplace_package_access", "revoked_at", "2026-09-20"],
  ["marketplace_package_access", "access_level", "preview"],
  ["buddy_sealed_packages", "unsealed_at", "2026-09-20"],
] as const) {
  test(`release rejects ${table}.${key}=${value}`, async () => {
    const rows = fixture(); rows[table][0][key] = value;
    assert.equal((await getBorrowerArtifactRelease("d", db(rows))).released, false);
  });
}
