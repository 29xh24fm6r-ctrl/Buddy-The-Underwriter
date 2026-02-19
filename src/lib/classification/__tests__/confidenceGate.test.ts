import test from "node:test";
import assert from "node:assert/strict";
import { applyConfidenceGate } from "../confidenceGate";
import type { Tier1Result, Tier2Result } from "../types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTier1(matched: boolean, confidence = 0.95): Tier1Result {
  return {
    matched,
    docType: matched ? "IRS_PERSONAL" : null,
    confidence: matched ? confidence : 0,
    anchorId: matched ? "IRS_1040_FORM_HEADER" : null,
    evidence: matched
      ? [{ type: "form_match", anchorId: "IRS_1040_FORM_HEADER", matchedText: "Form 1040", confidence }]
      : [],
    formNumbers: matched ? ["1040"] : null,
    taxYear: matched ? 2023 : null,
    entityType: matched ? "personal" : null,
  };
}

function makeTier2(matched: boolean, confidence = 0.85): Tier2Result {
  return {
    matched,
    docType: matched ? "RENT_ROLL" : null,
    confidence: matched ? confidence : 0,
    patternId: matched ? "RENT_ROLL_TENANT_TABLE" : null,
    evidence: matched
      ? [{ type: "structural_match", anchorId: "RENT_ROLL_TENANT_TABLE", matchedText: "Tenant table", confidence }]
      : [],
  };
}

// ─── Tier 1 always wins ─────────────────────────────────────────────────────

test("Gate: Tier 1 matched → accepted (always authoritative)", () => {
  const gate = applyConfidenceGate(makeTier1(true), makeTier2(false));
  assert.equal(gate.accepted, true);
  assert.equal(gate.source, "tier1");
  assert.equal(gate.docType, "IRS_PERSONAL");
});

test("Gate: Tier 1 matched overrides Tier 2 (even if Tier 2 also matched)", () => {
  const gate = applyConfidenceGate(makeTier1(true, 0.97), makeTier2(true, 0.87));
  assert.equal(gate.accepted, true);
  assert.equal(gate.source, "tier1");
  assert.equal(gate.docType, "IRS_PERSONAL");
});

// ─── Tier 2 threshold ───────────────────────────────────────────────────────

test("Gate: Tier 2 ≥ 0.80 → accepted", () => {
  const gate = applyConfidenceGate(makeTier1(false), makeTier2(true, 0.85));
  assert.equal(gate.accepted, true);
  assert.equal(gate.source, "tier2");
  assert.equal(gate.docType, "RENT_ROLL");
});

test("Gate: Tier 2 = 0.80 → accepted (boundary)", () => {
  const gate = applyConfidenceGate(makeTier1(false), makeTier2(true, 0.80));
  assert.equal(gate.accepted, true);
  assert.equal(gate.source, "tier2");
});

test("Gate: Tier 2 = 0.79 → escalated (below threshold)", () => {
  const gate = applyConfidenceGate(makeTier1(false), makeTier2(true, 0.79));
  assert.equal(gate.accepted, false);
  assert.equal(gate.source, "escalate_to_tier3");
});

test("Gate: Tier 2 = 0.75 → escalated", () => {
  const gate = applyConfidenceGate(makeTier1(false), makeTier2(true, 0.75));
  assert.equal(gate.accepted, false);
  assert.equal(gate.source, "escalate_to_tier3");
});

// ─── Neither matched ────────────────────────────────────────────────────────

test("Gate: neither Tier 1 nor Tier 2 matched → escalated", () => {
  const gate = applyConfidenceGate(makeTier1(false), makeTier2(false));
  assert.equal(gate.accepted, false);
  assert.equal(gate.source, "escalate_to_tier3");
  assert.equal(gate.docType, null);
  assert.equal(gate.confidence, 0);
});

// ─── Low confidence never accepted ──────────────────────────────────────────

test("Gate: Tier 2 low confidence (0.65) → NOT accepted", () => {
  const gate = applyConfidenceGate(makeTier1(false), makeTier2(true, 0.65));
  assert.equal(gate.accepted, false);
});

test("Gate: Tier 2 very low confidence (0.50) → NOT accepted", () => {
  const gate = applyConfidenceGate(makeTier1(false), makeTier2(true, 0.50));
  assert.equal(gate.accepted, false);
});
