/**
 * Institutional Extraction Guard Tests
 *
 * CI guards for the institutional extraction layer:
 * - A2: Failure codes completeness
 * - A3: Ledger event kinds completeness
 * - B3: Prompt versioning
 * - C3: No "estimate"/"best guess" in prompts
 * - Schema version consistency
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EXTRACTION_FAILURE_CODES,
  VALID_FAILURE_CODES,
  normalizeFailureCode,
} from "../failureCodes";

import {
  EXTRACTION_EVENT_KINDS,
  VALID_EXTRACTION_EVENT_KINDS,
  EXTRACTION_ENGINE_VERSION,
} from "../ledgerContract";

import {
  STRUCTURED_SCHEMA_VERSION,
  StructuredOutputSchema,
  validateStructuredOutput,
} from "../schemas/structuredOutput";

import {
  PROMPT_VERSION,
  buildStructuredAssistPrompt,
} from "../geminiFlashPrompts";

import {
  normalizeStructuredJson,
  computeStructuredOutputHash,
} from "../outputCanonicalization";

// ── A2: Failure Codes ────────────────────────────────────────────────

describe("A2: Failure Codes", () => {
  it("has exactly 12 failure codes", () => {
    assert.equal(Object.keys(EXTRACTION_FAILURE_CODES).length, 12);
  });

  it("all codes are non-empty strings", () => {
    for (const [key, val] of Object.entries(EXTRACTION_FAILURE_CODES)) {
      assert.equal(typeof val, "string", `${key} must be a string`);
      assert.ok(val.length > 0, `${key} must be non-empty`);
    }
  });

  it("VALID_FAILURE_CODES set matches EXTRACTION_FAILURE_CODES", () => {
    assert.equal(VALID_FAILURE_CODES.size, Object.keys(EXTRACTION_FAILURE_CODES).length);
    for (const code of Object.values(EXTRACTION_FAILURE_CODES)) {
      assert.ok(VALID_FAILURE_CODES.has(code), `${code} missing from VALID_FAILURE_CODES`);
    }
  });

  it("normalizeFailureCode returns null for null/undefined", () => {
    assert.equal(normalizeFailureCode(null), null);
    assert.equal(normalizeFailureCode(undefined), null);
  });

  it("normalizeFailureCode returns UNKNOWN_FATAL for invalid codes", () => {
    assert.equal(normalizeFailureCode("MADE_UP_CODE"), "UNKNOWN_FATAL");
  });

  it("normalizeFailureCode passes through valid codes", () => {
    assert.equal(normalizeFailureCode("OCR_FAILED"), "OCR_FAILED");
    assert.equal(normalizeFailureCode("STRUCTURED_TIMEOUT"), "STRUCTURED_TIMEOUT");
  });
});

// ── A3: Ledger Events ────────────────────────────────────────────────

describe("A3: Ledger Event Kinds", () => {
  it("has exactly 10 event kinds", () => {
    assert.equal(Object.keys(EXTRACTION_EVENT_KINDS).length, 10);
  });

  it("all event kinds start with 'extraction.'", () => {
    for (const [key, kind] of Object.entries(EXTRACTION_EVENT_KINDS)) {
      assert.ok(kind.startsWith("extraction."), `${key}: ${kind} must start with extraction.`);
    }
  });

  it("VALID_EXTRACTION_EVENT_KINDS set matches", () => {
    assert.equal(
      VALID_EXTRACTION_EVENT_KINDS.size,
      Object.keys(EXTRACTION_EVENT_KINDS).length,
    );
  });

  it("engine version is non-empty and follows semver-like pattern", () => {
    assert.ok(EXTRACTION_ENGINE_VERSION.length > 0);
    assert.match(EXTRACTION_ENGINE_VERSION, /^[a-z_]+_v\d+\.\d+$/);
  });
});

// ── B1: Schema Versioning ────────────────────────────────────────────

describe("B1: Structured Output Schema", () => {
  it("schema version is non-empty", () => {
    assert.ok(STRUCTURED_SCHEMA_VERSION.length > 0);
    assert.match(STRUCTURED_SCHEMA_VERSION, /^structured_v\d+$/);
  });

  it("validates valid structured output", () => {
    const valid = {
      entities: [
        { type: "gross_receipts", mentionText: "1,234,567", confidence: 0.95 },
      ],
      formFields: [
        { name: "ein", value: "12-3456789", confidence: 0.9 },
      ],
    };

    const result = validateStructuredOutput(valid);
    assert.ok(result.valid, `Expected valid but got errors: ${result.errors.join(", ")}`);
    assert.ok(result.data);
    assert.equal(result.data.entities.length, 1);
    assert.equal(result.data.formFields.length, 1);
  });

  it("rejects null input", () => {
    const result = validateStructuredOutput(null);
    assert.ok(!result.valid);
    assert.equal(result.data, null);
  });

  it("rejects entity without type", () => {
    const result = validateStructuredOutput({
      entities: [{ mentionText: "1000", confidence: 0.5 }],
      formFields: [],
    });
    assert.ok(!result.valid);
  });

  it("rejects formField without name", () => {
    const result = validateStructuredOutput({
      entities: [],
      formFields: [{ value: "foo", confidence: 0.5 }],
    });
    assert.ok(!result.valid);
  });

  it("accepts empty arrays", () => {
    const result = validateStructuredOutput({ entities: [], formFields: [] });
    assert.ok(result.valid);
  });
});

// ── B2: Output Canonicalization ──────────────────────────────────────

describe("B2: Output Canonicalization", () => {
  it("normalizes identical objects to the same shape", () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    const na = JSON.stringify(normalizeStructuredJson(a));
    const nb = JSON.stringify(normalizeStructuredJson(b));
    assert.equal(na, nb);
  });

  it("strips null values", () => {
    const input = { a: 1, b: null, c: "hi" };
    const normalized = normalizeStructuredJson(input) as any;
    assert.equal(normalized.a, 1);
    assert.equal(normalized.c, "hi");
    assert.equal(normalized.b, undefined);
  });

  it("computeStructuredOutputHash returns deterministic hash", () => {
    const a = { entities: [{ type: "x" }], formFields: [] };
    const b = { formFields: [], entities: [{ type: "x" }] };
    const ha = computeStructuredOutputHash(a);
    const hb = computeStructuredOutputHash(b);
    assert.equal(ha, hb);
  });

  it("computeStructuredOutputHash returns null for empty input", () => {
    assert.equal(computeStructuredOutputHash(null), null);
    assert.equal(computeStructuredOutputHash({}), null);
  });
});

// ── B3: Prompt Versioning ────────────────────────────────────────────

describe("B3: Prompt Versioning", () => {
  it("PROMPT_VERSION is non-empty and follows naming convention", () => {
    assert.ok(PROMPT_VERSION.length > 0);
    assert.match(PROMPT_VERSION, /^flash_prompts_v\d+$/);
  });

  it("all prompt builders include promptVersion in output", () => {
    const types = [
      "BUSINESS_TAX_RETURN",
      "PERSONAL_TAX_RETURN",
      "BALANCE_SHEET",
      "INCOME_STATEMENT",
    ];

    for (const dt of types) {
      const prompt = buildStructuredAssistPrompt(dt, "test text");
      assert.ok(prompt, `No prompt for ${dt}`);
      assert.equal(prompt.promptVersion, PROMPT_VERSION, `promptVersion missing for ${dt}`);
    }
  });

  it("unsupported type returns null", () => {
    assert.equal(buildStructuredAssistPrompt("UNKNOWN", "text"), null);
    assert.equal(buildStructuredAssistPrompt("RENT_ROLL", "text"), null);
  });
});

// ── C3: No "estimate" or "best guess" in prompts ────────────────────

describe("C3: Prompt Safety Guards", () => {
  const FORBIDDEN_PROMPT_WORDS = ["estimate", "best guess", "approximate", "infer"];

  it("no forbidden words in any prompt", () => {
    const types = [
      "BUSINESS_TAX_RETURN",
      "PERSONAL_TAX_RETURN",
      "BALANCE_SHEET",
      "INCOME_STATEMENT",
    ];

    for (const dt of types) {
      const prompt = buildStructuredAssistPrompt(dt, "");
      assert.ok(prompt);

      const fullText = (
        prompt.systemInstruction + " " + prompt.userPrompt
      ).toLowerCase();

      for (const word of FORBIDDEN_PROMPT_WORDS) {
        assert.ok(
          !fullText.includes(word),
          `Prompt for ${dt} contains forbidden word "${word}"`,
        );
      }
    }
  });

  it("prompts require null for missing/uncertain values", () => {
    const types = [
      "BUSINESS_TAX_RETURN",
      "PERSONAL_TAX_RETURN",
      "BALANCE_SHEET",
      "INCOME_STATEMENT",
    ];

    for (const dt of types) {
      const prompt = buildStructuredAssistPrompt(dt, "");
      assert.ok(prompt);

      const fullText = (
        prompt.systemInstruction + " " + prompt.userPrompt
      ).toLowerCase();

      assert.ok(
        fullText.includes("null"),
        `Prompt for ${dt} must mention "null" for missing values`,
      );
    }
  });
});
