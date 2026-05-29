/**
 * SPEC-FINANCIAL-PERIOD-REVIEW-QUEUE-FOLLOWTHROUGH-2 — lifecycle wiring guards
 *
 * An OPEN financial_statement_period_reviews row must surface as the
 * `financial_period_review_open` lifecycle blocker (gating underwrite readiness)
 * and clear once no OPEN reviews remain. blockerToStage mapping + exhaustiveness
 * is covered in components/journey/__tests__/blockerToStage.test.ts; here we
 * guard the emission site and the blocker registration.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blockerGatesStage } from "../blockerToStage";

const repoRoot = resolve(__dirname, "../../../..");
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), "utf8");

const DERIVE = read("src/buddy/lifecycle/deriveLifecycleState.ts");
const MODEL = read("src/buddy/lifecycle/model.ts");

describe("financial_period_review_open blocker wiring", () => {
  it("is registered in the LifecycleBlockerCode union", () => {
    assert.match(MODEL, /"financial_period_review_open"/);
  });

  it("deriveLifecycleState queries OPEN period reviews and pushes the blocker", () => {
    assert.match(DERIVE, /financial_statement_period_reviews/);
    assert.match(DERIVE, /code: "financial_period_review_open"/);
    // Gate condition: only OPEN reviews count.
    assert.match(DERIVE, /\.eq\("status", "OPEN"\)/);
    // Only emit when at least one open review exists (no false blocker on zero).
    assert.match(DERIVE, /openPeriodReviews \?\? 0\) > 0/);
  });

  it("emission is non-fatal (wrapped so a gate failure never blocks derivation)", () => {
    // The query block must sit inside a try/catch that swallows errors.
    const idx = DERIVE.indexOf('code: "financial_period_review_open"');
    assert.ok(idx > 0);
    const around = DERIVE.slice(Math.max(0, idx - 600), idx + 400);
    assert.match(around, /try \{/);
    assert.match(around, /Non-fatal — period review gate failure/);
  });

  it("gates underwrite_ready (financial readiness), matching its sibling blockers", () => {
    assert.equal(blockerGatesStage("financial_period_review_open"), "underwrite_ready");
  });
});
