/**
 * SPEC-BANKER-FLOW-FIX-BATCH-1 — Guard tests
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const VERTEX_SRC = readFileSync(resolve(__dirname, "../../ai/vertexLocation.ts"), "utf-8");
const READINESS_SRC = readFileSync(resolve(__dirname, "../readiness.ts"), "utf-8");
const SBA_SRC = readFileSync(resolve(__dirname, "../../sba/eligibilityEngine.ts"), "utf-8");
const OBSERVER_SRC = readFileSync(resolve(__dirname, "../../aegis/spreadsInvariants.ts"), "utf-8");
const GCF_SRC = readFileSync(resolve(__dirname, "../../financialIntelligence/persistGlobalCashFlow.ts"), "utf-8");
const RECOMPUTE_SRC = readFileSync(
  resolve(__dirname, "../../../app/api/deals/[dealId]/financial-snapshot/recompute/route.ts"),
  "utf-8",
);

describe("SPEC-BANKER-FLOW-FIX-BATCH-1 guards", () => {
  // Fix 1
  test("getVertexLocation default is us-central1 not us", () => {
    assert.ok(VERTEX_SRC.includes('"us-central1"'));
    assert.ok(!VERTEX_SRC.includes('Default: "us"'));
  });

  // Fix 2b
  test("readiness uploads_pending filters intake_status", () => {
    assert.ok(READINESS_SRC.includes("UPLOADED"));
    assert.ok(READINESS_SRC.includes("LOCKED_FOR_PROCESSING"));
  });

  // Fix 3
  test("evaluateSbaEligibility returns not_applicable for non-SBA loan products", () => {
    assert.ok(SBA_SRC.includes('"not_applicable"'));
    assert.ok(SBA_SRC.includes("loanProductType"));
    assert.ok(SBA_SRC.includes('!loanProductType.startsWith("SBA")'));
  });

  test("SbaEligibilityStatus includes not_applicable", () => {
    assert.ok(SBA_SRC.includes('"not_applicable"'));
  });

  // Fix 4
  test("recompute route infers entity_type from BUSINESS_TAX_RETURN", () => {
    assert.ok(RECOMPUTE_SRC.includes("BUSINESS_TAX_RETURN"));
    assert.ok(RECOMPUTE_SRC.includes('entity_type: "C_CORP"'));
  });

  // Fix 5
  test("spread observer sets status to queued not error on timeout", () => {
    // The observer should set status: "queued" in the auto-heal block
    assert.ok(
      OBSERVER_SRC.includes('status: "queued"'),
      "Observer must reset to queued on timeout, not error",
    );
  });

  // Fix 6
  test("persistGlobalCashFlow filters Borrower placeholder from ownership_entities", () => {
    assert.ok(GCF_SRC.includes('"borrower"'));
    assert.ok(GCF_SRC.includes('"pending autofill"'));
  });

  // Fix 7 — borrower routes already denormalize borrower_name (verified in §0)

  // Fix 1 comment
  test("vertexLocation.ts mentions @google/genai regional endpoint requirement", () => {
    assert.ok(VERTEX_SRC.includes("@google/genai"));
  });
});
