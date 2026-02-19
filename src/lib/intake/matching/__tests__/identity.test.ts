/**
 * Document Identity Builder — Unit Tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildDocumentIdentity, type SpineSignals, type GatekeeperSignals } from "../identity";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpine(overrides?: Partial<SpineSignals>): SpineSignals {
  return {
    docType: "IRS_BUSINESS",
    confidence: 0.97,
    spineTier: "tier1_anchor",
    taxYear: 2024,
    entityType: "business",
    formNumbers: ["1120S"],
    evidence: [
      {
        type: "form_match",
        anchorId: "anchor:1120s",
        matchedText: "Form 1120-S",
        confidence: 0.97,
      },
    ],
    ...overrides,
  };
}

function makeGatekeeper(overrides?: Partial<GatekeeperSignals>): GatekeeperSignals {
  return {
    docType: "BUSINESS_TAX_RETURN",
    confidence: 0.92,
    taxYear: 2024,
    formNumbers: ["1120S"],
    effectiveDocType: "BUSINESS_TAX_RETURN",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("Identity: deterministic authority from Tier 1 anchor", () => {
  const id = buildDocumentIdentity({
    documentId: "doc-1",
    spine: makeSpine({ spineTier: "tier1_anchor" }),
    gatekeeper: null,
  });
  assert.equal(id.authority, "deterministic");
});

test("Identity: deterministic authority from Tier 2 structural", () => {
  const id = buildDocumentIdentity({
    documentId: "doc-2",
    spine: makeSpine({ spineTier: "tier2_structural" }),
    gatekeeper: null,
  });
  assert.equal(id.authority, "deterministic");
});

test("Identity: probabilistic authority from Tier 3 LLM", () => {
  const id = buildDocumentIdentity({
    documentId: "doc-3",
    spine: makeSpine({ spineTier: "tier3_llm" }),
    gatekeeper: null,
  });
  assert.equal(id.authority, "probabilistic");
});

test("Identity: probabilistic authority from gatekeeper-only", () => {
  const id = buildDocumentIdentity({
    documentId: "doc-4",
    spine: null,
    gatekeeper: makeGatekeeper(),
  });
  assert.equal(id.authority, "probabilistic");
});

test("Identity: manual authority overrides spine tier", () => {
  const id = buildDocumentIdentity({
    documentId: "doc-5",
    spine: makeSpine({ spineTier: "tier1_anchor" }),
    gatekeeper: null,
    matchSource: "manual",
  });
  assert.equal(id.authority, "manual");
});

test("Identity: taxYear prefers gatekeeper over spine", () => {
  const id = buildDocumentIdentity({
    documentId: "doc-6",
    spine: makeSpine({ taxYear: 2023 }),
    gatekeeper: makeGatekeeper({ taxYear: 2024 }),
  });
  assert.equal(id.taxYear, 2024);
});

test("Identity: taxYear falls back to spine when gatekeeper null", () => {
  const id = buildDocumentIdentity({
    documentId: "doc-7",
    spine: makeSpine({ taxYear: 2023 }),
    gatekeeper: null,
  });
  assert.equal(id.taxYear, 2023);
});

test("Identity: effectiveDocType prefers gatekeeper", () => {
  const id = buildDocumentIdentity({
    documentId: "doc-8",
    spine: makeSpine({ docType: "IRS_BUSINESS" }),
    gatekeeper: makeGatekeeper({ effectiveDocType: "BUSINESS_TAX_RETURN" }),
  });
  assert.equal(id.effectiveDocType, "BUSINESS_TAX_RETURN");
});

test("Identity: formNumbers merged and deduplicated", () => {
  const id = buildDocumentIdentity({
    documentId: "doc-9",
    spine: makeSpine({ formNumbers: ["1120S", "K-1"] }),
    gatekeeper: makeGatekeeper({ formNumbers: ["1120S", "W-2"] }),
  });
  assert.deepEqual(id.formNumbers?.sort(), ["1120S", "K-1", "W-2"].sort());
});

test("Identity: evidence concatenated from both sources", () => {
  const id = buildDocumentIdentity({
    documentId: "doc-10",
    spine: makeSpine(),
    gatekeeper: makeGatekeeper(),
  });
  // Spine has 1 evidence item, gatekeeper adds 1 synthetic
  assert.equal(id.classificationEvidence.length, 2);
  assert.equal(id.classificationEvidence[0].type, "form_match");
  assert.equal(id.classificationEvidence[1].type, "gatekeeper_signal");
});

test("Identity: entityType prefers spine", () => {
  const id = buildDocumentIdentity({
    documentId: "doc-11",
    spine: makeSpine({ entityType: "business" }),
    gatekeeper: makeGatekeeper(),
  });
  assert.equal(id.entityType, "business");
});

test("Identity: fallback spine tier is probabilistic", () => {
  const id = buildDocumentIdentity({
    documentId: "doc-12",
    spine: makeSpine({ spineTier: "fallback" }),
    gatekeeper: null,
  });
  assert.equal(id.authority, "probabilistic");
});
