/**
 * SPEC-VALIDATION-GATE-RESTORE-PROGRAM-1 Phase 1 — canonical fact-key normalization.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

// Stub "server-only" so transitive imports (FormSpec getters) don't throw.
mockServerOnly();

describe("canonical fact-key normalization", async () => {
  const {
    EXTRACTOR_TO_CANONICAL,
    CANONICAL_KEYS_EMITTED_VERBATIM,
    OPERANDS_PENDING_EXTRACTION,
    canonicalizeFactMap,
  } = await import("../canonicalFactKeys");
  const { getForm1040Spec } = await import("../formSpecs/form1040");
  const { getForm1065Spec } = await import("../formSpecs/form1065");
  const { getForm1120Spec, getForm1120SSpec } = await import("../formSpecs/form1120");
  const { getScheduleCSpec } = await import("../formSpecs/scheduleC");
  const { getScheduleESpec } = await import("../formSpecs/scheduleE");

  // T1 — extractor M1_TAXABLE_INCOME (line 28) normalizes to canonical TAXABLE_INCOME.
  it("[T1] M1_TAXABLE_INCOME -> TAXABLE_INCOME", () => {
    const out = canonicalizeFactMap({ M1_TAXABLE_INCOME: 200925 });
    assert.equal(out.TAXABLE_INCOME, 200925);
  });

  // T2 — direct canonical value wins over an alias source.
  it("[T2] direct TAXABLE_INCOME wins over M1_TAXABLE_INCOME alias", () => {
    const out = canonicalizeFactMap({ TAXABLE_INCOME: 5, M1_TAXABLE_INCOME: 9 });
    assert.equal(out.TAXABLE_INCOME, 5);
  });

  // T3 — Schedule L balance-sheet trio normalizes.
  it("[T3] SL_TOTAL_* -> TOTAL_ASSETS/LIABILITIES/EQUITY", () => {
    const out = canonicalizeFactMap({
      SL_TOTAL_ASSETS: 10,
      SL_TOTAL_LIABILITIES: 4,
      SL_TOTAL_EQUITY: 6,
    });
    assert.equal(out.TOTAL_ASSETS, 10);
    assert.equal(out.TOTAL_LIABILITIES, 4);
    assert.equal(out.TOTAL_EQUITY, 6);
  });

  // T4 — 1040 wage + Sch C net-profit components normalize.
  it("[T4] WAGES_W2 -> W2_WAGES and SCHEDULE_C_NET_PROFIT -> SCH_C_NET_PROFIT", () => {
    const out = canonicalizeFactMap({ WAGES_W2: 1, SCHEDULE_C_NET_PROFIT: 2 });
    assert.equal(out.W2_WAGES, 1);
    assert.equal(out.SCH_C_NET_PROFIT, 2);
    // SCHEDULE_C_NET_PROFIT also feeds the Schedule-C NET_PROFIT identity.
    assert.equal(out.NET_PROFIT, 2);
  });

  // Extra — null raw value is treated as absent (no alias written).
  it("[null-as-absent] null source does not populate canonical", () => {
    const out = canonicalizeFactMap({ M1_TAXABLE_INCOME: null });
    assert.equal(out.TAXABLE_INCOME ?? null, null);
  });

  // T5 — completeness guard: every identityCheck operand across all 5 FormSpecs is
  // either emitted verbatim, aliased, or explicitly pending extraction.
  it("[T5] every FormSpec identityChecks operand is covered", () => {
    const specs = [
      getForm1040Spec(2024),
      getForm1065Spec(2022),
      getForm1065Spec(2024),
      getForm1120Spec(2024),
      getForm1120SSpec(2024),
      getScheduleCSpec(2024),
      getScheduleESpec(2024),
    ];

    // Canonical keys reachable through the alias map.
    const aliasTargets = new Set<string>();
    for (const targets of Object.values(EXTRACTOR_TO_CANONICAL)) {
      for (const t of Array.isArray(targets) ? targets : [targets]) aliasTargets.add(t);
    }

    const operands = new Set<string>();
    for (const spec of specs) {
      for (const check of spec.identityChecks) {
        for (const k of [...check.lhs, ...check.rhs]) operands.add(k);
      }
    }

    const uncovered: string[] = [];
    for (const op of operands) {
      const covered =
        CANONICAL_KEYS_EMITTED_VERBATIM.has(op) ||
        aliasTargets.has(op) ||
        OPERANDS_PENDING_EXTRACTION.has(op);
      if (!covered) uncovered.push(op);
    }

    assert.deepEqual(
      uncovered,
      [],
      `Uncovered FormSpec operands (add an alias, mark verbatim, or list as pending): ${uncovered.join(", ")}`,
    );
  });

  // Guard — the pending set stays minimal and intentional (not a dumping ground).
  it("[T5-pending] OPERANDS_PENDING_EXTRACTION is the documented minimal set", () => {
    assert.deepEqual([...OPERANDS_PENDING_EXTRACTION].sort(), ["SCH_E_MORTGAGE_INTEREST"]);
  });
});
