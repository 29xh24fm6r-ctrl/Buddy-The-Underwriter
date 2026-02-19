/**
 * Identity Intelligence Guard — CI-Blocking Governance Invariants (Layer 2.5)
 *
 * Validates the pure intelligence decision engines:
 *   1. NAME_DOC_TYPES_FOR_KIND covers expected entity kinds (PERSON, OPCO, PROPCO, HOLDCO)
 *   2. Single doc name, no conflict → RENAME_SYNTHETIC HIGH (single_doc_name_match)
 *   3. Multiple unique doc names → NO_CHANGE INSUFFICIENT (name_conflict)
 *   4. Banker name only (no docs) → RENAME_SYNTHETIC HIGH (banker_name_only)
 *   5. Single PERSON + single OPCO + SBA_7A → INFER_OWNER_OF 100%
 *   6. Multiple PERSONs → NO_INFERENCE (multi_person_ambiguous)
 *   7. EIN exact match → HIGH attribution suggestion
 *
 * Pure function tests — no DB, no IO, no side effects.
 * Imports only from intelligence pure modules.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeRefineSyntheticDecision,
  NAME_DOC_TYPES_FOR_KIND,
  type SyntheticEntity,
  type DocumentSignal,
} from "../../../identity/intelligence/refineSyntheticDecision";
import {
  computeOwnershipDecision,
} from "../../../identity/intelligence/ownershipDecision";
import {
  computeAttributionDecision,
  type AttributionEntityInput,
  type AttributionDocumentSignal,
} from "../../../identity/intelligence/attributionDecision";

// ---------------------------------------------------------------------------
// Guard 1: NAME_DOC_TYPES_FOR_KIND covers expected entity kinds
// ---------------------------------------------------------------------------

test("NAME_DOC_TYPES_FOR_KIND covers PERSON, OPCO, PROPCO, HOLDCO", () => {
  const expectedKinds = ["PERSON", "OPCO", "PROPCO", "HOLDCO"];
  const mappingKeys = Object.keys(NAME_DOC_TYPES_FOR_KIND);

  for (const kind of expectedKinds) {
    assert.ok(
      mappingKeys.includes(kind),
      `NAME_DOC_TYPES_FOR_KIND must cover kind: ${kind}`,
    );
    assert.ok(
      Array.isArray(NAME_DOC_TYPES_FOR_KIND[kind]) &&
        NAME_DOC_TYPES_FOR_KIND[kind].length > 0,
      `NAME_DOC_TYPES_FOR_KIND[${kind}] must be a non-empty array`,
    );
  }

  console.log(
    `[identityIntelligenceGuard] NAME_DOC_TYPES_FOR_KIND coverage: ${mappingKeys.length}/4 ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 2: Single doc name, no conflict → RENAME_SYNTHETIC HIGH
// ---------------------------------------------------------------------------

test("refinement: single doc name, no banker conflict → RENAME_SYNTHETIC HIGH (single_doc_name_match)", () => {
  const entity: SyntheticEntity = {
    id: "e1",
    entity_kind: "PERSON",
    name: "Unassigned Owner",
    synthetic: true,
  };
  const documents: DocumentSignal[] = [
    {
      document_type: "PERSONAL_TAX_RETURN",
      entity_name: "John Smith",
      classification_confidence: 0.95,
    },
  ];

  const decision = computeRefineSyntheticDecision(entity, documents, null);

  assert.strictEqual(decision.action, "RENAME_SYNTHETIC");
  assert.strictEqual(decision.confidence, "HIGH");
  assert.strictEqual(decision.reason, "single_doc_name_match");
  assert.strictEqual(decision.proposedName, "John Smith");
  console.log(`[identityIntelligenceGuard] single doc name → RENAME_SYNTHETIC HIGH ✓`);
});

// ---------------------------------------------------------------------------
// Guard 3: Multiple unique doc names → NO_CHANGE INSUFFICIENT (name_conflict)
// ---------------------------------------------------------------------------

test("refinement: multiple unique doc names → NO_CHANGE INSUFFICIENT (name_conflict)", () => {
  const entity: SyntheticEntity = {
    id: "e1",
    entity_kind: "PERSON",
    name: "Unassigned Owner",
    synthetic: true,
  };
  const documents: DocumentSignal[] = [
    {
      document_type: "PERSONAL_TAX_RETURN",
      entity_name: "John Smith",
      classification_confidence: 0.95,
    },
    {
      document_type: "PERSONAL_FINANCIAL_STATEMENT",
      entity_name: "Jane Doe",
      classification_confidence: 0.92,
    },
  ];

  const decision = computeRefineSyntheticDecision(entity, documents, null);

  assert.strictEqual(decision.action, "NO_CHANGE");
  assert.strictEqual(decision.confidence, "INSUFFICIENT");
  assert.strictEqual(decision.reason, "name_conflict");
  console.log(`[identityIntelligenceGuard] multiple doc names → NO_CHANGE (name_conflict) ✓`);
});

// ---------------------------------------------------------------------------
// Guard 4: Banker name only (no docs) → RENAME_SYNTHETIC HIGH (banker_name_only)
// ---------------------------------------------------------------------------

test("refinement: banker name only (no docs) → RENAME_SYNTHETIC HIGH (banker_name_only)", () => {
  const entity: SyntheticEntity = {
    id: "e1",
    entity_kind: "OPCO",
    name: "Unassigned Business",
    synthetic: true,
  };
  const documents: DocumentSignal[] = []; // No documents yet

  const decision = computeRefineSyntheticDecision(
    entity,
    documents,
    "Acme Corp LLC",
  );

  assert.strictEqual(decision.action, "RENAME_SYNTHETIC");
  assert.strictEqual(decision.confidence, "HIGH");
  assert.strictEqual(decision.reason, "banker_name_only");
  assert.strictEqual(decision.proposedName, "Acme Corp LLC");
  console.log(`[identityIntelligenceGuard] banker name only → RENAME_SYNTHETIC HIGH ✓`);
});

// ---------------------------------------------------------------------------
// Guard 5: Single PERSON + single OPCO + SBA_7A → INFER_OWNER_OF 100%
// ---------------------------------------------------------------------------

test("ownership: single PERSON + single OPCO + SBA_7A → INFER_OWNER_OF 100%", () => {
  const entities = [
    { id: "person-1", entity_kind: "PERSON", synthetic: false },
    { id: "opco-1", entity_kind: "OPCO", synthetic: false },
  ];

  const decisions = computeOwnershipDecision(entities, "SBA_7A", []);

  assert.strictEqual(decisions.length, 1);
  assert.strictEqual(decisions[0].action, "INFER_OWNER_OF");
  assert.strictEqual(decisions[0].parentEntityId, "person-1");
  assert.strictEqual(decisions[0].childEntityId, "opco-1");
  assert.strictEqual(decisions[0].ownershipPct, 100);
  assert.strictEqual(decisions[0].reason, "single_person_single_opco_sba");
  console.log(`[identityIntelligenceGuard] single PERSON + OPCO + SBA → INFER_OWNER_OF 100% ✓`);
});

// ---------------------------------------------------------------------------
// Guard 6: Multiple PERSONs → NO_INFERENCE (multi_person_ambiguous)
// ---------------------------------------------------------------------------

test("ownership: multiple PERSONs → NO_INFERENCE (multi_person_ambiguous)", () => {
  const entities = [
    { id: "person-1", entity_kind: "PERSON", synthetic: false },
    { id: "person-2", entity_kind: "PERSON", synthetic: false },
    { id: "opco-1", entity_kind: "OPCO", synthetic: false },
  ];

  const decisions = computeOwnershipDecision(entities, "SBA_7A", []);

  assert.strictEqual(decisions.length, 1);
  assert.strictEqual(decisions[0].action, "NO_INFERENCE");
  assert.strictEqual(decisions[0].reason, "multi_person_ambiguous");
  console.log(`[identityIntelligenceGuard] multiple PERSONs → NO_INFERENCE (ambiguous) ✓`);
});

// ---------------------------------------------------------------------------
// Guard 7: EIN exact match → HIGH attribution suggestion
// ---------------------------------------------------------------------------

test("attribution: EIN exact match → HIGH suggestion (ein_exact_match)", () => {
  const slot = { required_doc_type: "BUSINESS_TAX_RETURN" };
  const entities: AttributionEntityInput[] = [
    { id: "opco-1", name: "Acme Corp", legal_name: "Acme Corp LLC", ein: "12-3456789" },
    { id: "opco-2", name: "Other Corp", legal_name: "Other Corp Inc", ein: "99-9999999" },
  ];
  const documentSignals: AttributionDocumentSignal[] = [
    {
      entity_name: null,
      ai_business_name: null,
      ai_borrower_name: null,
      ein_detected: "12-3456789",
    },
  ];

  const decision = computeAttributionDecision(slot, entities, documentSignals);

  assert.ok(decision.suggestion !== null, "suggestion must not be null for EIN match");
  assert.strictEqual(decision.suggestion!.suggestedEntityId, "opco-1");
  assert.strictEqual(decision.suggestion!.confidence, "HIGH");
  assert.strictEqual(decision.suggestion!.reason, "ein_exact_match");
  console.log(`[identityIntelligenceGuard] EIN exact match → HIGH suggestion ✓`);
});
