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
