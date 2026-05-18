/**
 * SPEC-T12-GATE-1 — T12 Eligibility Guard Tests (2026-05-18)
 *
 * Proves:
 *   1. isT12Eligible returns eligible:false for CONVENTIONAL and SBA deal types
 *   2. isT12CanonicalFactSource returns false for CONVENTIONAL and SBA
 *   3. orchestrateSpreads.ts imports isT12Eligible
 *   4. backfillFromSpreads.ts imports isT12CanonicalFactSource
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isT12Eligible, isT12CanonicalFactSource } from "../t12Eligibility";

// ── Pure function guards ─────────────────────────────────────────────

describe("isT12Eligible", () => {
  it("returns eligible:false for CONVENTIONAL", () => {
    const r = isT12Eligible({ deal_type: "CONVENTIONAL" });
    assert.equal(r.eligible, false);
  });

  it("returns eligible:false for SBA", () => {
    const r = isT12Eligible({ deal_type: "SBA" });
    assert.equal(r.eligible, false);
  });

  it("returns eligible:false for SBA_7A", () => {
    const r = isT12Eligible({ deal_type: "SBA_7A" });
    assert.equal(r.eligible, false);
  });

  it("returns eligible:false for SBA_504", () => {
    const r = isT12Eligible({ deal_type: "SBA_504" });
    assert.equal(r.eligible, false);
  });

  it("returns eligible:false for CONVENTIONAL even with has_monthly_statements=true", () => {
    const r = isT12Eligible({ deal_type: "CONVENTIONAL", has_monthly_statements: true });
    assert.equal(r.eligible, false);
  });

  it("returns eligible:true for CRE with has_monthly_statements=true", () => {
    const r = isT12Eligible({ deal_type: "CRE", has_monthly_statements: true });
    assert.equal(r.eligible, true);
  });

  it("returns eligible:false for CRE without monthly statements", () => {
    const r = isT12Eligible({ deal_type: "CRE", has_monthly_statements: false });
    assert.equal(r.eligible, false);
  });
});

describe("isT12CanonicalFactSource", () => {
  it("returns false for CONVENTIONAL", () => {
    assert.equal(isT12CanonicalFactSource({ deal_type: "CONVENTIONAL" }), false);
  });

  it("returns false for SBA", () => {
    assert.equal(isT12CanonicalFactSource({ deal_type: "SBA" }), false);
  });

  it("returns false for CONVENTIONAL even with has_monthly_statements=true", () => {
    assert.equal(
      isT12CanonicalFactSource({ deal_type: "CONVENTIONAL", has_monthly_statements: true }),
      false,
    );
  });

  it("returns true for CRE with has_monthly_statements=true", () => {
    assert.equal(
      isT12CanonicalFactSource({ deal_type: "CRE", has_monthly_statements: true }),
      true,
    );
  });

  it("returns false for CRE without monthly statements", () => {
    assert.equal(
      isT12CanonicalFactSource({ deal_type: "CRE", has_monthly_statements: false }),
      false,
    );
  });
});

// ── Source-inspection guards ─────────────────────────────────────────

const ORCHESTRATOR_SRC = readFileSync(
  resolve(__dirname, "../../spreads/orchestrateSpreads.ts"),
  "utf-8",
);

const BACKFILL_SRC = readFileSync(
  resolve(__dirname, "../../financialFacts/backfillFromSpreads.ts"),
  "utf-8",
);

describe("integration wiring guards", () => {
  it("orchestrateSpreads.ts imports isT12Eligible", () => {
    assert.ok(
      ORCHESTRATOR_SRC.includes("isT12Eligible"),
      "orchestrateSpreads.ts must import and use isT12Eligible from t12Eligibility",
    );
  });

  it("backfillFromSpreads.ts imports isT12CanonicalFactSource", () => {
    assert.ok(
      BACKFILL_SRC.includes("isT12CanonicalFactSource"),
      "backfillFromSpreads.ts must import and use isT12CanonicalFactSource from t12Eligibility",
    );
  });
});
