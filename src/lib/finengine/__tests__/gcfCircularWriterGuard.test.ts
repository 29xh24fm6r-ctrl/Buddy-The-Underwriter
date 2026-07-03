/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 19 tests.
 *
 * The kill switch defaults ENABLED (no live change). When quarantined, ZERO
 * canonical facts are planned — the anti-circularity guarantee. Plus the shadow
 * comparison to finengine GCF.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isGcfCircularWriterEnabled,
  planGcfFactWrites,
  compareRenderedGcfToFinengine,
  GCF_CIRCULAR_WRITER_KILL_SWITCH_ENV,
  type GcfWritePlan,
} from "@/lib/finengine/gcf/circularWriterGuard";

const renderedGcf = {
  rows: [
    { key: "GCF_GLOBAL_CASH_FLOW", values: [{ value: 1_250_000 }] },
    { key: "GCF_DSCR", values: [1.35] },
    { key: "GCF_CASH_AVAILABLE", values: [{ value: 900_000 }] },
  ],
};

describe("PR19 — kill switch default (no live change)", () => {
  it("defaults ENABLED when the env flag is absent", () => {
    assert.equal(isGcfCircularWriterEnabled({}), true);
  });
  it("stays enabled for an empty/unset value", () => {
    assert.equal(isGcfCircularWriterEnabled({ [GCF_CIRCULAR_WRITER_KILL_SWITCH_ENV]: "" }), true);
  });
  it("plans the same facts the legacy extractor produced when enabled", () => {
    const plan = planGcfFactWrites(renderedGcf, { enabled: true });
    assert.equal(plan.quarantined, false);
    const keys = plan.writes.map((w) => w.factKey);
    assert.ok(keys.includes("GCF_GLOBAL_CASH_FLOW"));
    assert.ok(keys.includes("GLOBAL_CASH_FLOW")); // legacy alias
    assert.ok(keys.includes("GCF_DSCR"));
    assert.ok(keys.includes("GCF_CASH_AVAILABLE"));
  });
});

describe("PR19 — quarantine writes nothing (anti-circularity)", () => {
  it("returns ZERO writes when disabled via env", () => {
    const plan: GcfWritePlan = planGcfFactWrites(renderedGcf, {
      env: { [GCF_CIRCULAR_WRITER_KILL_SWITCH_ENV]: "true" },
    });
    assert.equal(plan.quarantined, true);
    assert.deepEqual(plan.writes, []);
  });

  it("honors explicit enabled=false", () => {
    const plan = planGcfFactWrites(renderedGcf, { enabled: false });
    assert.equal(plan.quarantined, true);
    assert.equal(plan.writes.length, 0);
  });

  it("recognizes several disable spellings", () => {
    for (const v of ["1", "true", "yes", "on", "TRUE", "On"]) {
      assert.equal(isGcfCircularWriterEnabled({ [GCF_CIRCULAR_WRITER_KILL_SWITCH_ENV]: v }), false, v);
    }
  });
});

describe("PR19 — shadow comparison to finengine GCF", () => {
  it("match within tolerance", () => {
    assert.equal(compareRenderedGcfToFinengine(1_250_000, 1_250_000.2).status, "match");
  });
  it("divergent beyond tolerance", () => {
    const c = compareRenderedGcfToFinengine(1_250_000, 1_100_000);
    assert.equal(c.status, "divergent");
    assert.ok(c.relDiff! > 0.1);
  });
  it("missing when either side null", () => {
    assert.equal(compareRenderedGcfToFinengine(null, 1_000_000).status, "missing");
  });
});
