/**
 * Confidence Gate — Unit Tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldAutoAttach,
  DETERMINISTIC_THRESHOLD,
  PROBABILISTIC_THRESHOLD,
} from "../confidenceGate";
import type { DocumentIdentity } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIdentity(overrides?: Partial<DocumentIdentity>): DocumentIdentity {
  return {
    documentId: "doc-1",
    effectiveDocType: "BUSINESS_TAX_RETURN",
    rawDocType: "IRS_BUSINESS",
    taxYear: 2024,
    entityType: "business",
    formNumbers: null,
    authority: "deterministic",
    confidence: 0.97,
    classificationEvidence: [
      { type: "form_match", anchorId: "a1", matchedText: "1120S", confidence: 0.97 },
    ],
    period: null,
    entity: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("ConfidenceGate: thresholds are correct", () => {
  assert.equal(DETERMINISTIC_THRESHOLD, 0.90);
  assert.equal(PROBABILISTIC_THRESHOLD, 0.85);
});

test("ConfidenceGate: deterministic at 0.97 → auto_attach", () => {
  const result = shouldAutoAttach(
    makeIdentity({ authority: "deterministic", confidence: 0.97 }),
  );
  assert.equal(result.decision, "auto_attach");
});

test("ConfidenceGate: deterministic at 0.90 → auto_attach (boundary)", () => {
  const result = shouldAutoAttach(
    makeIdentity({ authority: "deterministic", confidence: 0.90 }),
  );
  assert.equal(result.decision, "auto_attach");
});

test("ConfidenceGate: deterministic at 0.89 → route_to_review", () => {
  const result = shouldAutoAttach(
    makeIdentity({ authority: "deterministic", confidence: 0.89 }),
  );
  assert.equal(result.decision, "route_to_review");
});

test("ConfidenceGate: probabilistic at 0.92 → auto_attach", () => {
  const result = shouldAutoAttach(
    makeIdentity({ authority: "probabilistic", confidence: 0.92 }),
  );
  assert.equal(result.decision, "auto_attach");
});

test("ConfidenceGate: probabilistic at 0.85 → auto_attach (boundary)", () => {
  const result = shouldAutoAttach(
    makeIdentity({ authority: "probabilistic", confidence: 0.85 }),
  );
  assert.equal(result.decision, "auto_attach");
});

test("ConfidenceGate: probabilistic at 0.83 → route_to_review", () => {
  const result = shouldAutoAttach(
    makeIdentity({ authority: "probabilistic", confidence: 0.83 }),
  );
  assert.equal(result.decision, "route_to_review");
});

test("ConfidenceGate: manual authority always auto_attach", () => {
  const result = shouldAutoAttach(
    makeIdentity({ authority: "manual", confidence: 0.5 }),
  );
  assert.equal(result.decision, "auto_attach");
});

test("ConfidenceGate: no evidence → route_to_review", () => {
  const result = shouldAutoAttach(
    makeIdentity({
      authority: "deterministic",
      confidence: 0.99,
      classificationEvidence: [],
    }),
  );
  assert.equal(result.decision, "route_to_review");
});

test("ConfidenceGate: manual with no evidence still auto_attach", () => {
  const result = shouldAutoAttach(
    makeIdentity({
      authority: "manual",
      confidence: 1.0,
      classificationEvidence: [],
    }),
  );
  assert.equal(result.decision, "auto_attach");
});
