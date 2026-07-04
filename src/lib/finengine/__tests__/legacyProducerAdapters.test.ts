/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 20 tests.
 *
 * Each producer defaults to legacy; the finengine path runs ONLY when its flag
 * is explicitly true. Both paths covered; the migration plan reflects the flags.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PRODUCER_FLAGS,
  isFinengineProducerEnabled,
  runProducer,
  runProducerAsync,
  migrationPlan,
  CONSUMER_PRODUCERS,
  type ProducerFlags,
} from "@/lib/finengine/cutover";

describe("PR20 — default is legacy everywhere", () => {
  it("every producer flag defaults false", () => {
    for (const v of Object.values(DEFAULT_PRODUCER_FLAGS)) assert.equal(v, false);
  });

  it("runProducer routes to legacy by default", () => {
    const r = runProducer("computeGlobalCashFlow", { legacy: () => "L", finengine: () => "F" });
    assert.equal(r.value, "L");
    assert.equal(r.path, "legacy");
  });

  it("finengine impl is NOT invoked on the default path", () => {
    let finengineCalled = false;
    const r = runProducer("computeTotalDebtService", { legacy: () => 1, finengine: () => { finengineCalled = true; return 2; } });
    assert.equal(r.value, 1);
    assert.equal(finengineCalled, false);
  });
});

describe("PR20 — finengine path only behind an explicit true flag", () => {
  const on: ProducerFlags = { ...DEFAULT_PRODUCER_FLAGS, computeGlobalCashFlow: true };

  it("routes to finengine when flag true", () => {
    const r = runProducer("computeGlobalCashFlow", { legacy: () => "L", finengine: () => "F" }, on);
    assert.equal(r.value, "F");
    assert.equal(r.path, "finengine");
  });

  it("does not affect other producers", () => {
    assert.equal(isFinengineProducerEnabled("computeTotalDebtService", on), false);
  });

  it("async variant honors the flag and awaits", async () => {
    const legacyR = await runProducerAsync("persistGlobalCashFlow", { legacy: async () => "L", finengine: async () => "F" });
    assert.equal(legacyR.value, "L");
    const on2: ProducerFlags = { ...DEFAULT_PRODUCER_FLAGS, persistGlobalCashFlow: true };
    const finR = await runProducerAsync("persistGlobalCashFlow", { legacy: async () => "L", finengine: async () => "F" }, on2);
    assert.equal(finR.value, "F");
  });
});

describe("PR20 — migration plan", () => {
  it("all six consumers default to legacy", () => {
    const plan = migrationPlan();
    assert.equal(plan.length, 6);
    for (const row of plan) assert.equal(row.defaultPath, "legacy");
  });

  it("a consumer flips to finengine only when ALL its producers are enabled", () => {
    // pricing_assumptions_route depends only on computeTotalDebtService.
    const flags: ProducerFlags = { ...DEFAULT_PRODUCER_FLAGS, computeTotalDebtService: true };
    const plan = migrationPlan(flags);
    const pricing = plan.find((r) => r.consumer === "pricing_assumptions_route")!;
    assert.equal(pricing.defaultPath, "finengine");
    // snapshot_recompute needs computeGlobalCashFlow too → still legacy.
    const snapshot = plan.find((r) => r.consumer === "snapshot_recompute")!;
    assert.equal(snapshot.defaultPath, "legacy");
    assert.deepEqual(snapshot.finengineEnabledProducers, ["computeTotalDebtService"]);
  });

  it("every consumer maps to at least one producer", () => {
    for (const producers of Object.values(CONSUMER_PRODUCERS)) assert.ok(producers.length > 0);
  });
});
