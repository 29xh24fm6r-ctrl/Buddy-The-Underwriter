/**
 * SPEC-FINENGINE-MEMO-GATE-PARITY-1 — shared memo-generation preconditions.
 *
 * The two renderer-independent data-integrity gates (research trust + validation
 * pass) that BOTH the legacy and finengine generate-route branches enforce
 * through this one helper, so they can't drift. Loaders are injected so the test
 * never touches the server-only DB client.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  enforceMemoGenerationPreconditions,
  type PreconditionLoaders,
} from "@/lib/creditMemo/memoGenerationPreconditions";

// Loader factory — defaults to the "clean" shape (research allowed, no validation report).
function loaders(over: Partial<PreconditionLoaders> = {}): PreconditionLoaders {
  return {
    loadResearchTrust: async () => ({ allowed: true }),
    loadValidationGating: async () => null,
    ...over,
  };
}

describe("enforceMemoGenerationPreconditions", () => {
  it("blocks (400) when research trust explicitly FAILs, surfacing the reason", async () => {
    const r = await enforceMemoGenerationPreconditions(
      "deal-1",
      loaders({ loadResearchTrust: async () => ({ allowed: false, reason: "Research trust failed: contaminated source." }) }),
    );
    assert.equal(r.allowed, false);
    assert.equal(r.status, 400);
    assert.match(r.error!, /contaminated source/);
  });

  it("falls back to a generic reason when research FAILs without a reason string", async () => {
    const r = await enforceMemoGenerationPreconditions(
      "deal-1",
      loaders({ loadResearchTrust: async () => ({ allowed: false }) }),
    );
    assert.equal(r.allowed, false);
    assert.equal(r.status, 400);
    assert.match(r.error!, /research trust/i);
  });

  it("blocks (400) when the latest validation report is BLOCK_GENERATION", async () => {
    const r = await enforceMemoGenerationPreconditions(
      "deal-1",
      loaders({ loadValidationGating: async () => "BLOCK_GENERATION" }),
    );
    assert.equal(r.allowed, false);
    assert.equal(r.status, 400);
    assert.match(r.error!, /Validation has flagged blocking issues/);
  });

  it("allows (200) when both gates pass — research allowed, no validation report (the OmniCare shape)", async () => {
    const r = await enforceMemoGenerationPreconditions("omnicare", loaders());
    assert.equal(r.allowed, true);
    assert.equal(r.status, 200);
    assert.equal(r.error, undefined);
  });

  it("allows when a validation report exists but is non-blocking (PASS / WARN)", async () => {
    for (const decision of ["PASS", "WARN", "ALLOW_GENERATION"]) {
      const r = await enforceMemoGenerationPreconditions("deal-1", loaders({ loadValidationGating: async () => decision }));
      assert.equal(r.allowed, true, `decision ${decision} should not block`);
    }
  });

  it("enforces research trust BEFORE validation — a research FAIL short-circuits even if validation would block", async () => {
    let validationCalled = false;
    const r = await enforceMemoGenerationPreconditions(
      "deal-1",
      loaders({
        loadResearchTrust: async () => ({ allowed: false, reason: "trust fail" }),
        loadValidationGating: async () => {
          validationCalled = true;
          return "BLOCK_GENERATION";
        },
      }),
    );
    assert.equal(r.allowed, false);
    assert.match(r.error!, /trust fail/);
    assert.equal(validationCalled, false, "validation loader must not run once research has already failed");
  });

  it("does NOT enforce an ai_risk_run — the helper carries only the two renderer-independent gates", async () => {
    // The ai_risk_runs hard-require is legacy-renderer-only by design; the engine
    // supersedes it with its own deterministic riskRating. This helper must allow
    // a deal with no risk run when both renderer-independent gates pass.
    const r = await enforceMemoGenerationPreconditions("omnicare-zero-risk-runs", loaders());
    assert.equal(r.allowed, true);
  });
});
