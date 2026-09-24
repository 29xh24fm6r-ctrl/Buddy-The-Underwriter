import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let failedTable: string | null;
let sessionDeal: string;
let nextId: number;
class Query {
  filters: Array<(row: Row) => boolean> = [];
  inserted: Row | null = null;
  updates: Row | null = null;
  constructor(private table: string) {}
  select() { return this; }
  limit() { return this; }
  order() { return this; }
  eq(key: string, val: any) { this.filters.push(row => row[key] === val); return this; }
  neq(key: string, val: any) { this.filters.push(row => row[key] !== val); return this; }
  is(key: string, val: any) { this.filters.push(row => val === null ? row[key] == null : row[key] === val); return this; }
  in(key: string, vals: any[]) { this.filters.push(row => vals.includes(row[key])); return this; }
  insert(row: Row) { this.inserted = row; return this; }
  update(row: Row) { this.updates = row; return this; }
  result(single = false): any {
    if (this.table === failedTable) return { data: null, error: { message: "isolated failure" } };
    const rows = tables[this.table] ??= [];
    let matched = rows.filter(row => this.filters.every(predicate => predicate(row)));
    if (this.inserted) { const inserted = { id: `id-${nextId++}`, ...this.inserted }; rows.push(inserted); matched = [inserted]; }
    if (this.updates) matched.forEach(row => Object.assign(row, this.updates));
    return { data: single ? matched[0] ?? null : matched, error: null };
  }
  single() { return Promise.resolve(this.result(true)); }
  maybeSingle() { return this.single(); }
  then(resolve: any, reject: any) { return Promise.resolve(this.result()).then(resolve, reject); }
}
const mockModule = (path: string, exports: any) => { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports: { __esModule: true, ...exports } } as any; };
mockModule("@/lib/supabase/admin", { supabaseAdmin: () => ({ from: (table: string) => new Query(table) }) });
mockModule("@/lib/brokerage/sessionToken", { getBorrowerSession: async () => ({ deal_id: sessionDeal, bank_id: "origin-bank" }) });
mockModule("@/lib/brokerage/borrowerFormsOrchestration", { prepareBrokerageSbaForms: async () => ({ ok: true }) });
const { POST } = require("../route");
const pick = (claimId = "claim-1") => POST({ json: async () => ({ claimId }) }, { params: Promise.resolve({ dealId: "deal-1" }) });
test.beforeEach(() => {
  failedTable = null; sessionDeal = "deal-1"; nextId = 1;
  tables = {
    brokerage_lender_message_outbox: [],
    lender_marketplace_agreements: [{ lender_bank_id: "bank-1", status: "active", signed_by_email: "qa-lender@example.invalid" }],
    deals: [{ id: "deal-1", is_test: false }],
    marketplace_listings: [{ id: "listing-1", deal_id: "deal-1", sealed_package_id: "seal-1", status: "claiming" }],
    marketplace_claims: [
      { id: "claim-1", listing_id: "listing-1", lender_bank_id: "bank-1", status: "active" },
      { id: "claim-2", listing_id: "listing-1", lender_bank_id: "bank-2", status: "active" },
      { id: "foreign-claim", listing_id: "foreign-listing", lender_bank_id: "bank-3", status: "active" },
    ],
    buddy_sealed_packages: [{ id: "seal-1", deal_id: "deal-1", unsealed_at: null, final_business_plan_path: "sealed/plan.pdf", final_projections_path: "sealed/projections.xlsx", final_feasibility_path: "sealed/feasibility.pdf" }],
  };
});

test("bank selection proves pick, access, losing-claim withdrawal, audit and outbox; retry is idempotent", async () => {
  const response = await pick(); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.ok, true);
  assert.equal(body.pickedLenderBankId, "bank-1");
  assert.equal(tables.marketplace_listings[0].status, "picked");
  assert.equal(tables.marketplace_claims[1].status, "withdrawn");
  assert.equal(tables.marketplace_claims[2].status, "active");
  assert.equal(tables.marketplace_package_access[0].sealed_package_id, "seal-1");
  assert.equal(tables.marketplace_package_access[0].access_level, "full");
  assert.equal(tables.marketplace_audit_log[0].action, "borrower_pick");
  assert.equal(tables.brokerage_lender_message_outbox.length, 2);
  const retry = await pick(); assert.deepEqual(await retry.json(), body);
  assert.equal(tables.marketplace_picks.length, 1); assert.equal(tables.marketplace_package_access.length, 1); assert.equal(tables.marketplace_audit_log.length, 1);
});

test("interrupted handoff reports failure and resumes the same selection without duplicate grants", async () => {
  for (const table of ["marketplace_package_access", "marketplace_audit_log"]) {
    failedTable = table;
    assert.equal((await pick()).status, 503);
    failedTable = null;
    assert.equal((await pick()).status, 200);
    assert.equal(tables.marketplace_picks.length, 1);
    assert.equal(tables.marketplace_package_access.length, 1);
  }
  failedTable = "brokerage_lender_message_outbox";
  assert.equal((await pick()).status, 503);
  failedTable = null;
  assert.equal((await pick()).status, 200);
  assert.equal(tables.brokerage_lender_message_outbox.length, 2);
});

test("QA, foreign sessions, unrelated claims and missing sealed artifacts cannot grant access", async () => {
  sessionDeal = "other"; assert.equal((await pick()).status, 404);
  sessionDeal = "deal-1"; tables.deals[0].is_test = true;
  assert.equal((await pick()).status, 403); tables.deals[0].is_test = false;
  assert.equal((await pick("foreign-claim")).status, 400);
  tables.buddy_sealed_packages[0].final_projections_path = null;
  assert.equal((await pick()).status, 409);
  assert.equal(tables.marketplace_picks, undefined);
  assert.equal(tables.marketplace_package_access, undefined);
  assert.equal(tables.brokerage_lender_message_outbox.length, 0);
});

test("read failure or a conflicting existing pick cannot masquerade as a successful handoff", async () => {
  failedTable = "deals"; assert.equal((await pick()).status, 503);
  failedTable = "marketplace_listings"; assert.equal((await pick()).status, 503);
  failedTable = null;
  tables.marketplace_picks = [{ id: "old-pick", listing_id: "listing-1", deal_id: "deal-1", claim_id: "claim-2", picked_lender_bank_id: "bank-2", status: "picked" }];
  assert.equal((await pick()).status, 409);
  assert.equal(tables.marketplace_package_access, undefined);
  assert.equal(tables.brokerage_lender_message_outbox.length, 0);
});
