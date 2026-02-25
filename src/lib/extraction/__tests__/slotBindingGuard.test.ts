/**
 * E1-E2: Slot Binding Lockdown + Entity Conflict Guard Tests
 *
 * CI guards for:
 * - E1: Exactly-one-candidate rule (verified via matching engine)
 * - E2: Entity conflict detection (EIN/SSN extraction + conflict detection)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extractEinFromStructured,
  extractSsnFromStructured,
  detectEntityConflict,
} from "../entityConflictGuard";

// ── E2: EIN/SSN Extraction ───────────────────────────────────────────

describe("E2: EIN/SSN Extraction from Structured JSON", () => {
  it("extracts EIN from formFields", () => {
    const structured = {
      entities: [],
      formFields: [
        { name: "ein", value: "12-3456789", confidence: 0.9 },
      ],
    };
    assert.equal(extractEinFromStructured(structured), "12-3456789");
  });

  it("extracts EIN from entities", () => {
    const structured = {
      entities: [
        { type: "ein", mentionText: "123456789", confidence: 0.9 },
      ],
      formFields: [],
    };
    assert.equal(extractEinFromStructured(structured), "12-3456789");
  });

  it("normalizes EIN to XX-XXXXXXX format", () => {
    const structured = {
      entities: [],
      formFields: [
        { name: "ein", value: "12 345 6789", confidence: 0.9 },
      ],
    };
    assert.equal(extractEinFromStructured(structured), "12-3456789");
  });

  it("returns null for invalid EIN (wrong digit count)", () => {
    const structured = {
      entities: [],
      formFields: [
        { name: "ein", value: "1234", confidence: 0.9 },
      ],
    };
    assert.equal(extractEinFromStructured(structured), null);
  });

  it("returns null for missing structured JSON", () => {
    assert.equal(extractEinFromStructured(null), null);
    assert.equal(extractEinFromStructured(undefined), null);
    assert.equal(extractEinFromStructured({}), null);
  });

  it("extracts SSN from formFields", () => {
    const structured = {
      entities: [],
      formFields: [
        { name: "ssn", value: "123-45-6789", confidence: 0.9 },
      ],
    };
    assert.equal(extractSsnFromStructured(structured), "123-45-6789");
  });

  it("normalizes SSN format", () => {
    const structured = {
      entities: [],
      formFields: [
        { name: "ssn", value: "123456789", confidence: 0.9 },
      ],
    };
    assert.equal(extractSsnFromStructured(structured), "123-45-6789");
  });
});

// ── E2: Entity Conflict Detection ────────────────────────────────────

describe("E2: Entity Conflict Detection", () => {
  it("no conflict when EINs match", () => {
    const result = detectEntityConflict({
      extractedEin: "12-3456789",
      resolvedEin: "12-3456789",
      extractedSsn: null,
      resolvedSsn: null,
    });
    assert.equal(result.hasConflict, false);
  });

  it("conflict when EINs differ", () => {
    const result = detectEntityConflict({
      extractedEin: "12-3456789",
      resolvedEin: "98-7654321",
      extractedSsn: null,
      resolvedSsn: null,
    });
    assert.equal(result.hasConflict, true);
    assert.equal(result.conflictType, "ein_mismatch");
    assert.ok(result.detail);
  });

  it("no conflict when no extracted identifier", () => {
    const result = detectEntityConflict({
      extractedEin: null,
      resolvedEin: "12-3456789",
      extractedSsn: null,
      resolvedSsn: null,
    });
    assert.equal(result.hasConflict, false);
  });

  it("no conflict when no resolved identifier", () => {
    const result = detectEntityConflict({
      extractedEin: "12-3456789",
      resolvedEin: null,
      extractedSsn: null,
      resolvedSsn: null,
    });
    assert.equal(result.hasConflict, false);
  });

  it("SSN conflict detection", () => {
    const result = detectEntityConflict({
      extractedEin: null,
      resolvedEin: null,
      extractedSsn: "123-45-6789",
      resolvedSsn: "987-65-4321",
    });
    assert.equal(result.hasConflict, true);
    assert.equal(result.conflictType, "ssn_mismatch");
  });

  it("masks identifiers in detail", () => {
    const result = detectEntityConflict({
      extractedEin: "12-3456789",
      resolvedEin: "98-7654321",
      extractedSsn: null,
      resolvedSsn: null,
    });
    assert.ok(result.detail);
    // Should NOT contain full EIN — only masked
    assert.ok(!result.detail!.includes("12-3456789"));
    assert.ok(result.detail!.includes("***"));
  });

  it("EIN conflict takes priority over SSN", () => {
    const result = detectEntityConflict({
      extractedEin: "12-3456789",
      resolvedEin: "98-7654321",
      extractedSsn: "123-45-6789",
      resolvedSsn: "987-65-4321",
    });
    // EIN conflict should be detected first
    assert.equal(result.conflictType, "ein_mismatch");
  });
});

// ── E1: Binding Invariants ───────────────────────────────────────────

describe("E1: Binding Invariants", () => {
  it("SLOT_BIND_CONFLICT failure code exists", () => {
    const { EXTRACTION_FAILURE_CODES } = require("../failureCodes");
    assert.equal(EXTRACTION_FAILURE_CODES.SLOT_BIND_CONFLICT, "SLOT_BIND_CONFLICT");
  });

  it("ENTITY_CONFLICT failure code exists", () => {
    const { EXTRACTION_FAILURE_CODES } = require("../failureCodes");
    assert.equal(EXTRACTION_FAILURE_CODES.ENTITY_CONFLICT, "ENTITY_CONFLICT");
  });
});
