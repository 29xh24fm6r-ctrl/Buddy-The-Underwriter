/**
 * SPEC-PRICING-STAGE-GATE-FIX-1 — Guard tests
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LOCK_SRC = readFileSync(
  resolve(__dirname, "../../../app/api/deals/[dealId]/pricing/quote/[quoteId]/lock/route.ts"),
  "utf-8",
);
const BLOCKERS_SRC = readFileSync(
  resolve(__dirname, "../../../buddy/lifecycle/computeBlockers.ts"),
  "utf-8",
);

describe("SPEC-PRICING-STAGE-GATE-FIX-1 guards", () => {
  test("lock route upserts deal_risk_pricing_model with finalized=true", () => {
    assert.ok(LOCK_SRC.includes("deal_risk_pricing_model"));
    assert.ok(LOCK_SRC.includes("finalized: true"));
  });

  test("lock route calls scheduleReadinessRefresh after successful lock", () => {
    assert.ok(LOCK_SRC.includes("scheduleReadinessRefresh"));
  });

  test("computeBlockers does not emit risk_pricing_not_finalized when pricingQuoteReady", () => {
    assert.ok(
      BLOCKERS_SRC.includes("!derived.pricingQuoteReady"),
      "Blocker must also check pricingQuoteReady — locked quote satisfies the gate",
    );
  });
});
