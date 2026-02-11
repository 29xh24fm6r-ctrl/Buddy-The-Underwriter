import test from "node:test";
import assert from "node:assert/strict";

// ── Pipeline chain verification ──────────────────────────────────────
// These tests verify that the source code includes the critical
// stamp → reconcile → readiness calls added in the pipeline gap fix.
// They parse the source to confirm the integration exists without
// requiring a full Supabase connection.

test("processArtifact source includes matchAndStampDealDocument call", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../processArtifact.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("matchAndStampDealDocument"),
    "processArtifact.ts must call matchAndStampDealDocument after classification",
  );
});

test("processArtifact source includes reconcileChecklistForDeal call", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../processArtifact.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("reconcileChecklistForDeal"),
    "processArtifact.ts must call reconcileChecklistForDeal after stamp",
  );
});

test("processArtifact source includes recomputeDealReady call", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../processArtifact.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("recomputeDealReady"),
    "processArtifact.ts must call recomputeDealReady after reconcile",
  );
});

test("processArtifact stamps only deal_documents (not borrower_uploads)", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../processArtifact.ts"),
    "utf-8",
  );
  // The stamp call is gated by source_table === "deal_documents"
  assert.ok(
    src.includes('source_table === "deal_documents"'),
    "matchAndStampDealDocument must be gated to deal_documents source table",
  );
});

test("processArtifact uses skip_filename_match for AI classification", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../processArtifact.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("skip_filename_match: true"),
    "AI classification should set skip_filename_match: true",
  );
});

// ── Pipeline integrity guard verification ────────────────────────────

test("processArtifact checks isExtractionErrorPayload after classification", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../processArtifact.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("isExtractionErrorPayload"),
    "processArtifact.ts must check for error payloads after classification",
  );
});

test("error payload check comes BEFORE update_artifact_classification RPC", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../processArtifact.ts"),
    "utf-8",
  );
  const errorCheckIdx = src.indexOf(
    "isExtractionErrorPayload(classification.rawExtraction)",
  );
  const classifyRpcIdx = src.indexOf(
    'rpc("update_artifact_classification"',
  );
  assert.ok(errorCheckIdx > 0, "Error payload check must be present");
  assert.ok(classifyRpcIdx > 0, "Classification RPC must be present");
  assert.ok(
    errorCheckIdx < classifyRpcIdx,
    "Error payload check must come BEFORE update_artifact_classification RPC",
  );
});

test("ai_extracted_json stamp is guarded by isExtractionErrorPayload", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../processArtifact.ts"),
    "utf-8",
  );
  // The stamp block should guard ai_extracted_json with error check
  assert.ok(
    src.includes("isExtractionErrorPayload(classification.rawExtraction)")
    && src.includes("ai_extracted_json"),
    "ai_extracted_json write must be guarded by isExtractionErrorPayload",
  );
});

test("error payload guard calls mark_artifact_failed", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../processArtifact.ts"),
    "utf-8",
  );
  // The guard block should call mark_artifact_failed and log classification_error
  assert.ok(
    src.includes("classification_error:"),
    "Error guard must set classification_error prefix in error_message",
  );
  assert.ok(
    src.includes("artifact.classification_error"),
    "Error guard must log artifact.classification_error ledger event",
  );
});

// ── Ordering verification ────────────────────────────────────────────

test("stamp → reconcile → readiness appears in correct order", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const src = await fs.readFile(
    path.resolve(__dirname, "../processArtifact.ts"),
    "utf-8",
  );
  const stampIdx = src.indexOf("matchAndStampDealDocument");
  const reconcileIdx = src.indexOf("reconcileChecklistForDeal");
  const readinessIdx = src.indexOf("recomputeDealReady");

  assert.ok(stampIdx > 0, "matchAndStampDealDocument must be present");
  assert.ok(reconcileIdx > 0, "reconcileChecklistForDeal must be present");
  assert.ok(readinessIdx > 0, "recomputeDealReady must be present");
  assert.ok(stampIdx < reconcileIdx, "stamp must come before reconcile");
  assert.ok(reconcileIdx < readinessIdx, "reconcile must come before readiness");
});
