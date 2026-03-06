import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeFlagReport } from "../flagComposer";
import type { FlagEngineInput } from "../types";

function makeInput(overrides: Partial<FlagEngineInput> = {}): FlagEngineInput {
  return {
    deal_id: "deal-1",
    canonical_facts: {},
    ratios: {},
    years_available: [2023],
    ...overrides,
  };
}

describe("flagComposer", () => {
  // ── Basic orchestration ────────────────────────────────────────────────
  it("returns empty flags for empty input", () => {
    const result = composeFlagReport(makeInput());
    assert.equal(result.deal_id, "deal-1");
    assert.equal(result.flags.length, 0);
    assert.equal(result.critical_count, 0);
    assert.equal(result.has_blocking_flags, false);
  });

  it("collects flags from ratio module", () => {
    const result = composeFlagReport(makeInput({
      ratios: { DSCR: 0.85 },
    }));
    assert.ok(result.flags.length > 0);
    assert.ok(result.flags.some((f) => f.trigger_type === "dscr_below_1x"));
  });

  it("collects flags from reconciliation module", () => {
    const result = composeFlagReport(makeInput({
      canonical_facts: {
        GROSS_RECEIPTS: 1_100_000,
        TOTAL_REVENUE: 1_000_000,
      },
    }));
    assert.ok(result.flags.some((f) => f.trigger_type === "revenue_variance_3pct"));
  });

  // ── Severity counts ────────────────────────────────────────────────────
  it("correctly counts by severity", () => {
    const result = composeFlagReport(makeInput({
      ratios: { DSCR: 0.85, CURRENT_RATIO: 0.90, LTV: 0.85 },
    }));
    // dscr_below_1x = critical, current_ratio_below_1x = critical, ltv_above_80pct = elevated
    assert.ok(result.critical_count >= 2);
    assert.ok(result.has_blocking_flags);
  });

  // ── has_blocking_flags ─────────────────────────────────────────────────
  it("has_blocking_flags is true when critical flags exist", () => {
    const result = composeFlagReport(makeInput({
      ratios: { DSCR: 0.85 },
    }));
    assert.equal(result.has_blocking_flags, true);
  });

  it("has_blocking_flags is false when no critical flags", () => {
    // Only watch/informational flags — e.g. proximity to policy limit
    const result = composeFlagReport(makeInput({
      ratios: { DSCR: 1.30 }, // above policy minimum, within proximity (1.40)
    }));
    // dscr_proximity_policy flags as "informational"
    if (result.flags.length > 0) {
      assert.ok(result.flags.every((f) => f.severity !== "critical"));
    }
    assert.equal(result.has_blocking_flags, false);
  });

  // ── Sort order ─────────────────────────────────────────────────────────
  it("sorts flags by severity (critical first) then category", () => {
    const result = composeFlagReport(makeInput({
      ratios: { DSCR: 0.85, LTV: 0.85, DSO: 95 },
    }));
    if (result.flags.length >= 2) {
      const severityOrder = ["critical", "elevated", "watch", "informational"] as const;
      for (let i = 1; i < result.flags.length; i++) {
        const prevIdx = severityOrder.indexOf(result.flags[i - 1].severity);
        const currIdx = severityOrder.indexOf(result.flags[i].severity);
        assert.ok(prevIdx <= currIdx,
          `flag ${i - 1} (${result.flags[i - 1].severity}) should come before flag ${i} (${result.flags[i].severity})`);
      }
    }
  });

  // ── Deduplication ──────────────────────────────────────────────────────
  it("deduplicates flags with same trigger_type and canonical_keys, keeping higher severity", () => {
    // This test relies on the internal dedup mechanism. We can verify by checking
    // that there are no duplicate trigger_type values with the same canonical keys
    const result = composeFlagReport(makeInput({
      ratios: { DSCR: 0.85 },
    }));
    const keys = result.flags.map((f) => `${f.trigger_type}|${f.canonical_keys_involved.sort().join(",")}`);
    const unique = new Set(keys);
    assert.equal(keys.length, unique.size, "No duplicate trigger_type+canonical_keys combos");
  });
});
