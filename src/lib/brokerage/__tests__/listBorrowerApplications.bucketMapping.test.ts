import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { bucketForStage, labelForStage } = require("../listBorrowerApplications") as
  typeof import("../listBorrowerApplications");

// ---------------------------------------------------------------------------
// Active stages
// ---------------------------------------------------------------------------

test("active stages bucket as active", () => {
  for (const stage of [
    "intake",
    "docs_in_progress",
    "analysis",
    "underwriting",
    "conditional_approval",
    "closing",
  ]) {
    assert.equal(bucketForStage(stage), "active", `${stage} should be active`);
  }
});

// ---------------------------------------------------------------------------
// Completed
// ---------------------------------------------------------------------------

test("funded buckets as completed", () => {
  assert.equal(bucketForStage("funded"), "completed");
});

test("declined does NOT bucket as completed", () => {
  assert.notEqual(bucketForStage("declined"), "completed");
});

test("declined buckets as previous, not completed and not active", () => {
  const bucket = bucketForStage("declined");
  assert.equal(bucket, "previous");
  assert.notEqual(bucket, "completed");
  assert.notEqual(bucket, "active");
});

// ---------------------------------------------------------------------------
// Unknown / never-guess
// ---------------------------------------------------------------------------

test("null stage buckets as unknown, not silently classified", () => {
  assert.equal(bucketForStage(null), "unknown");
});

test("undefined stage buckets as unknown", () => {
  assert.equal(bucketForStage(undefined), "unknown");
});

test("empty-string stage buckets as unknown", () => {
  assert.equal(bucketForStage(""), "unknown");
});

test("an unrecognized/future stage value buckets as unknown, never guessed into active or completed", () => {
  const bucket = bucketForStage("some_future_stage_not_yet_mapped");
  assert.equal(bucket, "unknown");
  assert.notEqual(bucket, "active");
  assert.notEqual(bucket, "completed");
});

test("unknown stage never resolves to the completed bucket specifically (explicit requirement)", () => {
  assert.notEqual(bucketForStage("totally_unrecognized"), "completed");
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

test("unknown/null stage gets the safe 'Status unavailable' label, not a fabricated one", () => {
  assert.equal(labelForStage(null), "Status unavailable");
  assert.equal(labelForStage("nonexistent_stage"), "Status unavailable");
});

test("known stages get real, specific labels", () => {
  assert.equal(labelForStage("funded"), "Funded");
  assert.equal(labelForStage("declined"), "Declined");
  assert.equal(labelForStage("intake"), "Getting started");
});
