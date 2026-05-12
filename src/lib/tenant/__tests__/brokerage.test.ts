import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

type BankRow = { id: string; code: string | null };
let mockRows: BankRow[] = [];
let mockError: string | null = null;

function makeMockSb() {
  return {
    from(table: string) {
      assert.equal(table, "banks");
      return {
        select() {
          return this;
        },
        eq(_col: string, _val: string) {
          return Promise.resolve(
            mockError ? { data: null, error: { message: mockError } } : { data: mockRows, error: null },
          );
        },
      };
    },
  };
}

const adminStubExports = { supabaseAdmin: () => makeMockSb() as never };
require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "supabase-admin-stub",
  filename: "supabase-admin-stub",
  loaded: true,
  exports: adminStubExports,
} as any;

const mod = require("../brokerage") as typeof import("../brokerage");

function reset(rows: BankRow[], err: string | null = null) {
  mockRows = rows;
  mockError = err;
  mod.__test_resetBrokerageCache();
}

test("exports the required canonical constants", () => {
  assert.equal(mod.BROKERAGE_BANK_CODE, "BUDDY_BROKERAGE");
  assert.equal(mod.BROKERAGE_BANK_NAME, "Buddy Brokerage");
  assert.equal(mod.BROKERAGE_BANK_KIND, "brokerage");
});

test("getBrokerageBankId returns the single brokerage row id", async () => {
  reset([{ id: "abc-123", code: "BUDDY_BROKERAGE" }]);
  const id = await mod.getBrokerageBankId();
  assert.equal(id, "abc-123");
});

test("getBrokerageBankId throws BrokerageTenantMissingError when zero rows match", async () => {
  reset([]);
  await assert.rejects(
    mod.getBrokerageBankId(),
    (e: any) => e?.code === "brokerage_tenant_missing",
  );
});

test("getBrokerageBankId throws BrokerageTenantAmbiguousError when >1 row matches", async () => {
  reset([
    { id: "a", code: "BUDDY_BROKERAGE" },
    { id: "b", code: "buddy-brokerage" },
  ]);
  await assert.rejects(
    mod.getBrokerageBankId(),
    (e: any) => e?.code === "brokerage_tenant_ambiguous",
  );
});

test("isBrokerageTenant compares to the resolved singleton", async () => {
  reset([{ id: "xyz", code: "BUDDY_BROKERAGE" }]);
  assert.equal(await mod.isBrokerageTenant("xyz"), true);
  assert.equal(await mod.isBrokerageTenant("other"), false);
});

test("assertBrokerageTenant throws on non-brokerage bank id", async () => {
  reset([{ id: "xyz", code: "BUDDY_BROKERAGE" }]);
  await mod.assertBrokerageTenant("xyz"); // no throw
  await assert.rejects(
    mod.assertBrokerageTenant("commercial-bank-id"),
    (e: any) => e?.code === "brokerage_tenant_missing",
  );
});

test("getBrokerageBankId caches across calls until __test_resetBrokerageCache", async () => {
  reset([{ id: "first", code: "BUDDY_BROKERAGE" }]);
  assert.equal(await mod.getBrokerageBankId(), "first");
  // mutate underlying rows but don't reset cache → still returns 'first'
  mockRows = [{ id: "second", code: "BUDDY_BROKERAGE" }];
  assert.equal(await mod.getBrokerageBankId(), "first");
  mod.__test_resetBrokerageCache();
  assert.equal(await mod.getBrokerageBankId(), "second");
});
