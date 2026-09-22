import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";
import { packageBudgetBlockers } from "../packageBudgetPolicy";
mockServerOnly();
const require = createRequire(import.meta.url);
require.cache[require.resolve("@/lib/supabase/admin")] = { exports: { supabaseAdmin: () => { throw new Error("Use isolated client"); } }, loaded: true } as any;
const { assertPackageBudgetAvailable } = require("../packageBudget") as typeof import("../packageBudget");
const base = { role: "verifier", dailyLimit: 500000, consumed: 218170, reserved: 0, qaUsed: 218170, runUsed: 0, isTest: true, required: 150000 };
test("QA allowance blocks the observed failure even when global daily budget has room", () => {
  const failures = packageBudgetBlockers(base);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /QA daily allowance 250000 has 31830 remaining/);
});
test("production is not charged against the QA suballocation", () => assert.deepEqual(packageBudgetBlockers({ ...base, isTest: false }), []));
test("unsettled reservations, run exhaustion, malformed accounting and equality boundaries", () => {
  assert.match(packageBudgetBlockers({ ...base, qaUsed: 0, reserved: 200000 })[0], /daily allowance/);
  assert.match(packageBudgetBlockers({ ...base, runUsed: 150000 })[0], /run allowance/);
  assert.match(packageBudgetBlockers({ ...base, qaUsed: NaN })[0], /invalid/);
  assert.deepEqual(packageBudgetBlockers({ ...base, consumed: 100000, qaUsed: 100000 }), []);
});
function client(rows: any[], failTable?: string, isTest = true) {
  const reads: string[] = [];
  const day = new Date().toISOString().slice(0, 10);
  return { reads, from(table: string) {
    reads.push(table);
    let filtered = table === "deals" ? [{ id: "deal", bank_id: "bank", is_test: isTest }] : table === "ai_gateway_daily_budgets" ? [] : rows;
    let start = 0, end = Infinity, single = false;
    const q: any = { select: () => q, order: () => q,
      eq(key: string, val: any) { filtered = filtered.filter((row: any) => row[key] === val); return q; },
      range(a: number, b: number) { start = a; end = b + 1; return q; },
      single() { single = true; return q; },
      then(resolve: any) { return Promise.resolve({ data: single ? filtered[0] : filtered.slice(start, end), error: table === failTable ? {message:"offline"} : null }).then(resolve); },
    }; return q;
  }, day };
}
test("ledger reads page beyond 1000 rows and count actual zero instead of reserved tokens", async () => {
  const c = client([]);
  const rows = Array.from({length:1001}, (_,id) => ({ id, role:"verifier", is_qa:true, usage_day:c.day, actual_tokens:id < 1000 ? 0 : null, reserved_tokens:id < 1000 ? 999 : 218170 }));
  const db = client(rows);
  await assert.rejects(assertPackageBudgetAvailable({dealId:"deal",bankId:"bank"}, db as any), /QA daily allowance/);
  assert.equal(db.reads.filter(t => t === "ai_gateway_budget_reservations").length, 2);
});
test("tenancy and ledger errors fail closed without making a reservation", async () => {
  await assert.rejects(assertPackageBudgetAvailable({dealId:"deal",bankId:"wrong"},client([]) as any), /tenancy/);
  await assert.rejects(assertPackageBudgetAvailable({dealId:"deal",bankId:"bank"},client([],"ai_gateway_budget_reservations") as any), /ledger/);
  await assertPackageBudgetAvailable({dealId:"deal",bankId:"bank"}, client([]) as any);
});
