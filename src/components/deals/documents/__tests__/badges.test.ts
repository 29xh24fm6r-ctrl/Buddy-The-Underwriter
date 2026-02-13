/**
 * Document Badges — Regression Tests
 *
 * Locks the deterministic label + tone rules for:
 *   1. Checklist match badge (3 states)
 *   2. Pipeline processing badge (6 states)
 *   3. Null-safety (all-null input must not crash)
 *
 * Run: node --import tsx --test src/components/deals/documents/__tests__/badges.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getChecklistBadge,
  getPipelineBadge,
  type DealDocumentBadgeModel,
} from "../badges";

// ---------------------------------------------------------------------------
// Checklist badge — 3 states
// ---------------------------------------------------------------------------

describe("getChecklistBadge", () => {
  it("returns Matched with humanized key when checklist_key is present", () => {
    const doc: DealDocumentBadgeModel = {
      checklist_key: "PFS_2023",
      finalized_at: "2026-02-13T00:00:00Z",
    };
    const badge = getChecklistBadge(doc);
    assert.equal(badge.label, "Matched: PFS 2023");
    assert.equal(badge.tone, "green");
  });

  it("returns Classified, not matched when finalized but no checklist_key", () => {
    const doc: DealDocumentBadgeModel = {
      checklist_key: null,
      finalized_at: "2026-02-13T00:00:00Z",
    };
    const badge = getChecklistBadge(doc);
    assert.equal(badge.label, "Classified, not matched");
    assert.equal(badge.tone, "amber");
  });

  it("returns Pending classification when neither key nor finalized", () => {
    const doc: DealDocumentBadgeModel = {
      checklist_key: null,
      finalized_at: null,
    };
    const badge = getChecklistBadge(doc);
    assert.equal(badge.label, "Pending classification");
    assert.equal(badge.tone, "gray");
  });

  it("handles multi-segment checklist keys with underscores", () => {
    const doc: DealDocumentBadgeModel = {
      checklist_key: "BANK_STATEMENT_2024_Q1",
      finalized_at: "2026-01-01T00:00:00Z",
    };
    const badge = getChecklistBadge(doc);
    assert.equal(badge.label, "Matched: BANK STATEMENT 2024 Q1");
    assert.equal(badge.tone, "green");
  });
});

// ---------------------------------------------------------------------------
// Pipeline badge — key states
// ---------------------------------------------------------------------------

describe("getPipelineBadge", () => {
  it("returns Queued for queued artifact", () => {
    const badge = getPipelineBadge({ artifact_status: "queued" });
    assert.equal(badge.label, "Queued");
    assert.equal(badge.tone, "gray");
  });

  it("returns Processing for processing artifact", () => {
    const badge = getPipelineBadge({ artifact_status: "processing" });
    assert.equal(badge.label, "Processing");
    assert.equal(badge.tone, "blue");
  });

  it("returns Classified for classified artifact", () => {
    const badge = getPipelineBadge({ artifact_status: "classified" });
    assert.equal(badge.label, "Classified");
    assert.equal(badge.tone, "blue");
  });

  it("returns Complete for matched artifact", () => {
    const badge = getPipelineBadge({ artifact_status: "matched" });
    assert.equal(badge.label, "Complete");
    assert.equal(badge.tone, "green");
  });

  it("returns Complete for extracted artifact", () => {
    const badge = getPipelineBadge({ artifact_status: "extracted" });
    assert.equal(badge.label, "Complete");
    assert.equal(badge.tone, "green");
  });

  it("returns Failed with hoverText for failed artifact", () => {
    const errorMsg = "Claude API rate limit exceeded after 3 retries";
    const badge = getPipelineBadge({
      artifact_status: "failed",
      artifact_error: errorMsg,
    });
    assert.equal(badge.label, "Failed");
    assert.equal(badge.tone, "red");
    assert.equal(badge.hoverText, errorMsg);
  });

  it("returns Failed without hoverText when error is null", () => {
    const badge = getPipelineBadge({
      artifact_status: "failed",
      artifact_error: null,
    });
    assert.equal(badge.label, "Failed");
    assert.equal(badge.tone, "red");
    assert.equal(badge.hoverText, undefined);
  });

  it("returns Unknown for unrecognized status string", () => {
    const badge = getPipelineBadge({ artifact_status: "some_future_state" });
    assert.equal(badge.label, "Unknown");
    assert.equal(badge.tone, "gray");
  });
});

// ---------------------------------------------------------------------------
// Null safety — all-null doc model
// ---------------------------------------------------------------------------

describe("null safety", () => {
  const nullish: DealDocumentBadgeModel = {
    checklist_key: null,
    finalized_at: null,
    artifact_status: null,
    artifact_error: null,
  };

  it("checklist badge returns Pending classification for all-null doc", () => {
    const badge = getChecklistBadge(nullish);
    assert.equal(badge.label, "Pending classification");
    assert.equal(badge.tone, "gray");
  });

  it("pipeline badge returns Unknown for all-null doc", () => {
    const badge = getPipelineBadge(nullish);
    assert.equal(badge.label, "Unknown");
    assert.equal(badge.tone, "gray");
  });

  it("checklist badge handles undefined fields (empty object)", () => {
    const badge = getChecklistBadge({});
    assert.equal(badge.label, "Pending classification");
    assert.equal(badge.tone, "gray");
  });

  it("pipeline badge handles undefined fields (empty object)", () => {
    const badge = getPipelineBadge({});
    assert.equal(badge.label, "Unknown");
    assert.equal(badge.tone, "gray");
  });
});
