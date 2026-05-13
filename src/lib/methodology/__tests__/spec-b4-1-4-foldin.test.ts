/**
 * SPEC-B4.1.4 — applyOfficerCompFoldIn policy tests.
 *
 * The helper is the contract-enforcement seam between two callers
 * (computeBusinessEbitdaFacts writer + projectDscrForVariant projection).
 * Both callers go through this helper, so testing the helper directly is
 * sufficient to lock the policy.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { applyOfficerCompFoldIn } from "@/lib/methodology/applyOfficerCompFoldIn";
import type { MethodologySlate } from "@/lib/methodology/types";

function slate(overrides: Partial<MethodologySlate> = {}): MethodologySlate {
  return {
    ncads_source: "standard",
    ebitda_addback_stack: "standard",
    officer_comp: "standard",
    affiliate_ownership: "standard",
    living_expense: "standard",
    ...overrides,
  };
}

test("[b4-1-4-v1] aggressive + standard officer_comp + positive impact → fold", () => {
  const r = applyOfficerCompFoldIn({
    slate: slate({ ebitda_addback_stack: "aggressive", officer_comp: "standard" }),
    officerCompAdjustedEbitdaImpact: 75_000,
  });
  assert.equal(r.shouldFold, true);
  assert.equal(r.foldInAmount, 75_000);
});

test("[b4-1-4-v2] standard ebitda_addback_stack → NEVER fold", () => {
  for (const ocVariant of ["standard", "conservative", "no_normalization"] as const) {
    const r = applyOfficerCompFoldIn({
      slate: slate({ ebitda_addback_stack: "standard", officer_comp: ocVariant }),
      officerCompAdjustedEbitdaImpact: 75_000,
    });
    assert.equal(r.shouldFold, false, `standard + ${ocVariant} must not fold`);
    assert.equal(r.foldInAmount, 0);
  }
});

test("[b4-1-4-v3] aggressive + no_normalization → NEVER fold", () => {
  const r = applyOfficerCompFoldIn({
    slate: slate({ ebitda_addback_stack: "aggressive", officer_comp: "no_normalization" }),
    officerCompAdjustedEbitdaImpact: 75_000,
  });
  assert.equal(r.shouldFold, false);
  assert.equal(r.foldInAmount, 0);
});

test("[b4-1-4-v4] conservative ebitda_addback_stack → NEVER fold", () => {
  for (const ocVariant of ["standard", "conservative", "no_normalization"] as const) {
    const r = applyOfficerCompFoldIn({
      slate: slate({ ebitda_addback_stack: "conservative", officer_comp: ocVariant }),
      officerCompAdjustedEbitdaImpact: 75_000,
    });
    assert.equal(r.shouldFold, false, `conservative + ${ocVariant} must not fold`);
    assert.equal(r.foldInAmount, 0);
  }
});

test("[b4-1-4-v5] null officer-comp impact → NEVER fold even under aggressive", () => {
  const r = applyOfficerCompFoldIn({
    slate: slate({ ebitda_addback_stack: "aggressive", officer_comp: "standard" }),
    officerCompAdjustedEbitdaImpact: null,
  });
  assert.equal(r.shouldFold, false);
  assert.equal(r.foldInAmount, 0);
});

test("[b4-1-4-v6] zero officer-comp impact → NEVER fold even under aggressive", () => {
  const r = applyOfficerCompFoldIn({
    slate: slate({ ebitda_addback_stack: "aggressive", officer_comp: "standard" }),
    officerCompAdjustedEbitdaImpact: 0,
  });
  assert.equal(r.shouldFold, false);
  assert.equal(r.foldInAmount, 0);
});
