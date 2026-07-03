/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 25 tests.
 *
 * Production default = legacy. finengine only when the flag is on AND legacy vs
 * finengine DSCR match (or intended divergence). Unresolved gap → legacy.
 * Rollback reverts to legacy.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  cutoverCiTermDscr,
  rollbackCiTermDscr,
  PRODUCTION_CI_TERM_DSCR_FLAGS,
} from "@/lib/finengine/cutover/ciTermDscrCutover";
import { DEFAULT_PRODUCT_CUTOVER, type ProductCutoverFlagMap } from "@/lib/finengine/cutover/productCutoverFlags";

const flagsOn: ProductCutoverFlagMap = { ...DEFAULT_PRODUCT_CUTOVER, CI_TERM: true };

describe("PR25 — production default is legacy", () => {
  it("no broad cutover: production flags keep CI_TERM on legacy", () => {
    assert.equal(PRODUCTION_CI_TERM_DSCR_FLAGS.CI_TERM, false);
    const d = cutoverCiTermDscr({ legacyDscr: () => 1.25, finengineDscr: () => 1.25 });
    assert.equal(d.path, "legacy");
  });
});

describe("PR25 — finengine only when flagged AND reconciled", () => {
  it("flag on + matching DSCR → finengine", () => {
    const d = cutoverCiTermDscr({ legacyDscr: () => 1.25, finengineDscr: () => 1.2504, flags: flagsOn });
    assert.equal(d.path, "finengine");
    assert.equal(d.reconciliation.clean, true);
    assert.equal(d.reconciliation.reason, "dscr_match");
    assert.equal(d.value, 1.2504);
  });

  it("flag on + UNRESOLVED divergence → fails safe to legacy", () => {
    const d = cutoverCiTermDscr({ legacyDscr: () => 1.25, finengineDscr: () => 1.6, flags: flagsOn });
    assert.equal(d.path, "legacy");
    assert.equal(d.reconciliation.clean, false);
    assert.equal(d.reconciliation.reason, "unresolved_dscr_divergence");
    assert.equal(d.value, 1.25); // legacy value used
  });

  it("flag on + INTENDED divergence → finengine (documented)", () => {
    const d = cutoverCiTermDscr({
      legacyDscr: () => 1.25,
      finengineDscr: () => 1.6,
      flags: flagsOn,
      intendedDivergence: true,
    });
    assert.equal(d.path, "finengine");
    assert.equal(d.reconciliation.reason, "intended_divergence_registered");
  });

  it("missing value on one side → legacy (not clean)", () => {
    const d = cutoverCiTermDscr({ legacyDscr: () => 1.25, finengineDscr: () => null, flags: flagsOn });
    assert.equal(d.path, "legacy");
    assert.equal(d.reconciliation.reason, "missing_value_one_side");
  });

  it("flag off → legacy regardless of match", () => {
    const d = cutoverCiTermDscr({ legacyDscr: () => 1.25, finengineDscr: () => 1.25 });
    assert.equal(d.path, "legacy");
    assert.equal(d.cutoverReason, "cutover_flag_off");
  });
});

describe("PR25 — rollback", () => {
  it("rollback returns to the all-legacy default", () => {
    const rolled = rollbackCiTermDscr();
    assert.equal(rolled.CI_TERM, false);
    const d = cutoverCiTermDscr({ legacyDscr: () => 1.25, finengineDscr: () => 1.25, flags: rolled });
    assert.equal(d.path, "legacy");
  });
});
