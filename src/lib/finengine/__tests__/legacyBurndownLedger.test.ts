/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 26 tests.
 *
 * Every quarantined producer is listed; NOTHING is deletion-eligible yet; and
 * the safety invariant (deletion-eligible ⇒ reconciliation clean) holds.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LEGACY_BURNDOWN_LEDGER,
  validateBurndownLedger,
  anyDeletionEligible,
  type BurndownEntry,
} from "@/lib/finengine/cutover/legacyBurndownLedger";

describe("PR26 — burn-down ledger", () => {
  it("lists the four quarantined producers", () => {
    const producers = new Set(LEGACY_BURNDOWN_LEDGER.map((e) => e.producer));
    for (const p of ["computeGlobalCashFlow", "persistGlobalCashFlow", "computeTotalDebtService", "runCanonicalUnderwritingSynthesis"]) {
      assert.ok(producers.has(p), `missing ${p}`);
    }
  });

  it("every entry names consumers + a replacement module + a cutover flag", () => {
    for (const e of LEGACY_BURNDOWN_LEDGER) {
      assert.ok(e.consumers.length > 0, `${e.producer} consumers`);
      assert.ok(e.replacementModule.length > 0, `${e.producer} replacement`);
      assert.ok(e.cutoverFlag.length > 0, `${e.producer} flag`);
    }
  });

  it("NOTHING is deletion-eligible yet (safety rule 4)", () => {
    assert.equal(anyDeletionEligible(), false);
    for (const e of LEGACY_BURNDOWN_LEDGER) assert.equal(e.deletionEligible, false);
  });

  it("the ledger validates (no deletion-eligible-but-unclean entries)", () => {
    assert.deepEqual(validateBurndownLedger().violations, []);
    assert.equal(validateBurndownLedger().ok, true);
  });

  it("the validator CATCHES an illegal deletion-eligible-but-unclean entry", () => {
    const bad: BurndownEntry[] = [
      { ...LEGACY_BURNDOWN_LEDGER[0], deletionEligible: true, reconciliationStatus: "blocked" },
    ];
    const v = validateBurndownLedger(bad);
    assert.equal(v.ok, false);
    assert.ok(v.violations[0].includes("deletionEligible"));
  });
});
