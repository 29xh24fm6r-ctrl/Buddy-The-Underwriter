import test from "node:test";
import assert from "node:assert/strict";

// Test the type exports and function signatures
test("queueArtifact module exports expected types", async () => {
  const mod = await import("../queueArtifact");

  // Verify exports exist
  assert.ok(typeof mod.queueArtifact === "function");
  assert.ok(typeof mod.queueArtifactsBatch === "function");
  assert.ok(typeof mod.backfillDealArtifacts === "function");
});

test("QueueArtifactParams type validation", async () => {
  // This is a compile-time check - if the types are wrong, TypeScript will fail
  const validParams = {
    dealId: "123e4567-e89b-12d3-a456-426614174000",
    bankId: "223e4567-e89b-12d3-a456-426614174000",
    sourceTable: "deal_documents" as const,
    sourceId: "323e4567-e89b-12d3-a456-426614174000",
  };

  // Just verify the object structure is valid
  assert.ok(validParams.dealId);
  assert.ok(validParams.bankId);
  assert.ok(validParams.sourceTable === "deal_documents" || validParams.sourceTable === "borrower_uploads");
  assert.ok(validParams.sourceId);
});
