import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../../../../test/utils/mockServerOnly";
import { LENDER_PACKAGE_FILES } from "@/lib/brokerage/lenderPackageFiles";
mockServerOnly();
const require = createRequire(import.meta.url);
let tables: Record<string, any[]>;
let failedTable: string | null;
const sb = { from(table: string) {
  let rows = tables[table] ?? [];
  const result = () => ({ data: failedTable === table ? null : rows, error: failedTable === table ? { message: "unavailable" } : null, count: rows.length });
  const q: any = {
    select: () => q, order: () => q, limit: () => q,
    eq: (key: string, value: any) => { rows = rows.filter(row => row[key] === value); return q; },
    is: (key: string, value: any) => { rows = rows.filter(row => (row[key] ?? null) === value); return q; },
    in: (key: string, values: any[]) => { rows = rows.filter(row => values.includes(row[key])); return q; },
    not: (key: string, _operator: string, value: any) => { rows = rows.filter(row => (row[key] ?? null) !== value); return q; },
    maybeSingle: async () => ({ ...result(), data: failedTable === table ? null : rows[0] ?? null }),
    then: (resolve: any) => Promise.resolve(result()).then(resolve),
  };
  return q;
} };
const stub = (path: string, exports: any) => { require.cache[require.resolve(path)] = { exports } as any; };
stub("@/lib/supabase/admin", { supabaseAdmin: () => sb });
stub("@/lib/brokerage/sessionToken", { getBorrowerSession: async () => ({ deal_id: "deal", bank_id: "bank" }) });
stub("@/lib/brokerage/sealingGate", { canSeal: async () => ({ ok: false, reasons: ["Already sealed"] }) });
stub("@/lib/brokerage/borrowerConversation", { deepMerge: (a: any, b: any) => ({ ...a, ...b }) });
stub("@/lib/brokerage/packageDelivery", { buildBorrowerPackageManifest: async () => ({ resources: [] }) });
const { GET } = require("../route");
const get = () => GET({}, { params: Promise.resolve({ dealId: "deal" }) });

test.beforeEach(() => {
  failedTable = null;
  const sha256 = "a".repeat(64);
  tables = {
    marketplace_listings: [{ id: "listing", deal_id: "deal", sealed_package_id: "seal", status: "pending_preview", matched_lender_bank_ids: ["lender"] }],
    buddy_sealed_packages: [{ id: "seal", deal_id: "deal", bank_id: "bank", unsealed_at: null, sealed_snapshot: {
      tridentFinal: { bundleId: "bundle", inputHash: "input" }, packageCompletion: {
        version: 1, dealId: "deal", bankId: "bank", bundleId: "bundle", inputHash: "input", verifiedAt: "2026-09-24T12:00:00Z",
        archivePath: `deal/final/bundle/archives/lender/complete_package/${sha256}.zip`, sha256, sizeBytes: 5000,
        inventory: { version: 1, bundleId: "bundle", actor: "lender", files: LENDER_PACKAGE_FILES.map(file => ({
          kind: file.kind, filename: file.filename, category: "generated", sizeBytes: 100, sha256, borrowerVisible: file.kind !== "credit_memo",
        })) },
      },
    } }],
    marketplace_claims: [{ id: "claim", listing_id: "listing", lender_bank_id: "lender", status: "active" }],
    banks: [{ id: "lender", name: "Synthetic Bank" }],
  };
});

test("awaiting-pickup status exposes durable completion counts without releasing private evidence", async () => {
  const res = await get(); assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sealed, true);
  assert.equal(body.packageCompletion.generatedDocumentCount, 6);
  assert.equal(body.packageCompletion.verified, true);
  assert.equal(body.manifest, null);
  assert.ok(!JSON.stringify(body).includes("archives/"));
  assert.ok(!JSON.stringify(body).includes("credit_memo"));
});

for (const table of ["marketplace_listings", "buddy_sealed_packages", "marketplace_claims", "banks"]) test(`status retries ${table} outages instead of reporting absent progress`, async () => {
  tables.marketplace_listings[0].status = "awaiting_borrower_pick";
  failedTable = table;
  const res = await get(); assert.equal(res.status, 503);
  assert.equal((await res.json()).sealed, undefined);
});

test("a listing cannot report completion for a missing, foreign, unsealed or inconsistent package", async () => {
  const seal = tables.buddy_sealed_packages[0];
  for (const change of [{ bank_id: "other" }, { id: "different" }, { unsealed_at: "2026-09-24" }]) {
    tables.buddy_sealed_packages = [{ ...seal, ...change }];
    assert.equal((await get()).status, 503);
  }
  tables.buddy_sealed_packages = [seal];
  seal.sealed_snapshot.packageCompletion.bundleId = "different";
  assert.equal((await get()).status, 503);
});

test("legacy seals remain visible without inventing a full-package verification receipt", async () => {
  delete tables.buddy_sealed_packages[0].sealed_snapshot.packageCompletion;
  const body = await (await get()).json();
  assert.equal(body.sealed, true);
  assert.equal(body.packageCompletion, null);
});

test("malformed completion inventories produce a retryable status instead of a server exception", async () => {
  const proof = tables.buddy_sealed_packages[0].sealed_snapshot.packageCompletion;
  const valid = proof.inventory.files;
  for (const invalid of [[...valid, null], [...valid, valid[0]], valid.map((file: any) => ({ ...file, borrowerVisible: true }))]) {
    proof.inventory.files = invalid;
    const res = await get();
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "package_completion_invalid");
  }
});
