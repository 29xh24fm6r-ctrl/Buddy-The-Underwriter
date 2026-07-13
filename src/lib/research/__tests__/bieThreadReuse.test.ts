import test from "node:test";
import assert from "node:assert/strict";

import { planBIEThreadReuse } from "@/lib/research/bieThreadReuse";

const ok = { ok: true };
const failed = { ok: false };

test("nothing succeeded previously → nothing is reused", () => {
  const plan = planBIEThreadReuse({});
  for (const v of Object.values(plan)) assert.equal(v, false);
});

test("everything succeeded previously → everything is reused", () => {
  const plan = planBIEThreadReuse({
    entity_lock: ok, borrower: ok, management: ok, competitive: ok,
    market: ok, industry: ok, transaction: ok, synthesis: ok,
  });
  for (const v of Object.values(plan)) assert.equal(v, true);
});

test("entity_lock failed → borrower/management/competitive/transaction/synthesis cannot be reused even if they individually succeeded", () => {
  const plan = planBIEThreadReuse({
    entity_lock: failed, borrower: ok, management: ok, competitive: ok,
    market: ok, industry: ok, transaction: ok, synthesis: ok,
  });
  assert.equal(plan.entity_lock, false);
  assert.equal(plan.borrower, false, "borrower depends on entity_lock");
  assert.equal(plan.management, false, "management depends on entity_lock");
  assert.equal(plan.competitive, false, "competitive depends on entity_lock");
  // market/industry have no entity_lock dependency
  assert.equal(plan.market, true);
  assert.equal(plan.industry, true);
  // transaction depends on borrower/management/competitive, all now blocked
  assert.equal(plan.transaction, false);
  assert.equal(plan.synthesis, false);
});

test("only market failed → transaction and synthesis cannot be reused, but unrelated threads still can", () => {
  const plan = planBIEThreadReuse({
    entity_lock: ok, borrower: ok, management: ok, competitive: ok,
    market: failed, industry: ok, transaction: ok, synthesis: ok,
  });
  assert.equal(plan.entity_lock, true);
  assert.equal(plan.borrower, true);
  assert.equal(plan.management, true);
  assert.equal(plan.competitive, true);
  assert.equal(plan.industry, true);
  assert.equal(plan.market, false);
  assert.equal(plan.transaction, false, "transaction depends on market");
  assert.equal(plan.synthesis, false, "synthesis depends on transaction");
});

test("transaction previously failed but its own inputs all succeeded → only transaction+synthesis are re-run", () => {
  const plan = planBIEThreadReuse({
    entity_lock: ok, borrower: ok, management: ok, competitive: ok,
    market: ok, industry: ok, transaction: failed, synthesis: ok,
  });
  assert.equal(plan.borrower, true);
  assert.equal(plan.management, true);
  assert.equal(plan.competitive, true);
  assert.equal(plan.market, true);
  assert.equal(plan.industry, true);
  assert.equal(plan.transaction, false);
  assert.equal(plan.synthesis, false, "synthesis depends on transaction");
});

test("a thread absent from the previous-results map (never attempted) is treated as not succeeded", () => {
  const plan = planBIEThreadReuse({ entity_lock: ok, market: ok, industry: ok });
  assert.equal(plan.entity_lock, true);
  assert.equal(plan.borrower, false, "borrower was never attempted");
  assert.equal(plan.market, true);
});
