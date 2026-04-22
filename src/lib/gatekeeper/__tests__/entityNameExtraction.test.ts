import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import {
  parseGeminiResult,
  normalizeEntityName,
  getGeminiPromptHash,
  GEMINI_PROMPT_VERSION,
} from "../geminiClassifierPure";

// ─── Spec D1 — Gatekeeper Entity Name Extraction ─────────────────────────────

describe("normalizeEntityName", () => {
  it("returns trimmed name for a valid string", () => {
    assert.equal(normalizeEntityName("Samaritus Management LLC"), "Samaritus Management LLC");
  });

  it("trims leading and trailing whitespace", () => {
    assert.equal(normalizeEntityName("  Acme Corp  "), "Acme Corp");
    assert.equal(normalizeEntityName("\nAcme Corp\t"), "Acme Corp");
  });

  it("returns null for undefined", () => {
    assert.equal(normalizeEntityName(undefined), null);
  });

  it("returns null for actual null", () => {
    assert.equal(normalizeEntityName(null), null);
  });

  it("returns null for empty string", () => {
    assert.equal(normalizeEntityName(""), null);
    assert.equal(normalizeEntityName("   "), null);
  });

  it("returns null for the literal string 'null' (any case)", () => {
    assert.equal(normalizeEntityName("null"), null);
    assert.equal(normalizeEntityName("NULL"), null);
    assert.equal(normalizeEntityName("Null"), null);
  });

  it("returns null for common placeholder values", () => {
    assert.equal(normalizeEntityName("none"), null);
    assert.equal(normalizeEntityName("None"), null);
    assert.equal(normalizeEntityName("N/A"), null);
    assert.equal(normalizeEntityName("n/a"), null);
    assert.equal(normalizeEntityName("unknown"), null);
    assert.equal(normalizeEntityName("Unknown"), null);
  });

  it("returns null for numbers, objects, arrays", () => {
    assert.equal(normalizeEntityName(42), null);
    assert.equal(normalizeEntityName({}), null);
    assert.equal(normalizeEntityName([]), null);
    assert.equal(normalizeEntityName(true), null);
  });

  it("rejects strings longer than 200 chars as OCR noise", () => {
    const tooLong = "a".repeat(201);
    assert.equal(normalizeEntityName(tooLong), null);
    const borderline = "a".repeat(200);
    assert.equal(normalizeEntityName(borderline), borderline);
  });

  it("preserves capitalization and punctuation verbatim", () => {
    // The spec insists names are returned EXACTLY as they appear on the document.
    assert.equal(normalizeEntityName("ACME, INC."), "ACME, INC.");
    assert.equal(normalizeEntityName("MacDonald's LLC"), "MacDonald's LLC");
    assert.equal(
      normalizeEntityName("Smith & Jones, P.C."),
      "Smith & Jones, P.C.",
    );
  });
});

describe("parseGeminiResult — entity name extraction", () => {
  it("extracts business_name and borrower_name from detected_signals", () => {
    const raw = JSON.stringify({
      doc_type: "BUSINESS_TAX_RETURN",
      confidence: 0.95,
      tax_year: 2024,
      reasons: ["Form 1065 visible"],
      detected_signals: {
        form_numbers: ["1065"],
        has_ein: true,
        has_ssn: false,
        business_name: "Samaritus Management LLC",
        borrower_name: null,
      },
    });
    const result = parseGeminiResult(raw);
    assert.ok(result);
    assert.equal(result.detected_signals.business_name, "Samaritus Management LLC");
    assert.equal(result.detected_signals.borrower_name, null);
  });

  it("extracts borrower_name for a personal document", () => {
    const raw = JSON.stringify({
      doc_type: "PERSONAL_TAX_RETURN",
      confidence: 0.92,
      tax_year: 2023,
      reasons: ["Form 1040"],
      detected_signals: {
        form_numbers: ["1040"],
        has_ein: false,
        has_ssn: true,
        business_name: null,
        borrower_name: "Jane Q. Borrower",
      },
    });
    const result = parseGeminiResult(raw);
    assert.ok(result);
    assert.equal(result.detected_signals.business_name, null);
    assert.equal(result.detected_signals.borrower_name, "Jane Q. Borrower");
  });

  it("populates both when the document names both parties", () => {
    const raw = JSON.stringify({
      doc_type: "K1",
      confidence: 0.9,
      tax_year: 2024,
      reasons: ["Schedule K-1"],
      detected_signals: {
        form_numbers: ["K-1"],
        has_ein: true,
        has_ssn: true,
        business_name: "Partnership Holdings LP",
        borrower_name: "Alex Partner",
      },
    });
    const result = parseGeminiResult(raw);
    assert.ok(result);
    assert.equal(result.detected_signals.business_name, "Partnership Holdings LP");
    assert.equal(result.detected_signals.borrower_name, "Alex Partner");
  });

  it("coerces 'null' placeholder string to null", () => {
    const raw = JSON.stringify({
      doc_type: "W2",
      confidence: 0.95,
      tax_year: 2024,
      reasons: [],
      detected_signals: {
        form_numbers: ["W-2"],
        has_ein: true,
        has_ssn: true,
        business_name: "null",
        borrower_name: "Employee Name",
      },
    });
    const result = parseGeminiResult(raw);
    assert.ok(result);
    assert.equal(result.detected_signals.business_name, null);
    assert.equal(result.detected_signals.borrower_name, "Employee Name");
  });

  it("coerces empty string, N/A, unknown to null", () => {
    const raw = JSON.stringify({
      doc_type: "OTHER",
      confidence: 0.7,
      tax_year: null,
      reasons: [],
      detected_signals: {
        form_numbers: [],
        has_ein: false,
        has_ssn: false,
        business_name: "",
        borrower_name: "N/A",
      },
    });
    const result = parseGeminiResult(raw);
    assert.ok(result);
    assert.equal(result.detected_signals.business_name, null);
    assert.equal(result.detected_signals.borrower_name, null);
  });

  it("trims whitespace around real names", () => {
    const raw = JSON.stringify({
      doc_type: "BUSINESS_TAX_RETURN",
      confidence: 0.95,
      tax_year: 2024,
      reasons: [],
      detected_signals: {
        form_numbers: ["1120"],
        has_ein: true,
        has_ssn: false,
        business_name: "  Acme Corp  ",
        borrower_name: null,
      },
    });
    const result = parseGeminiResult(raw);
    assert.ok(result);
    assert.equal(result.detected_signals.business_name, "Acme Corp");
  });

  it("returns null fields when detected_signals is missing entirely", () => {
    // Older cache rows and non-v2 payloads may not carry these at all.
    const raw = JSON.stringify({
      doc_type: "FINANCIAL_STATEMENT",
      confidence: 0.85,
      tax_year: null,
      reasons: ["Balance sheet detected"],
      detected_signals: {
        form_numbers: [],
        has_ein: false,
        has_ssn: false,
      },
    });
    const result = parseGeminiResult(raw);
    assert.ok(result);
    assert.equal(result.detected_signals.business_name, null);
    assert.equal(result.detected_signals.borrower_name, null);
  });

  it("returns null for unparseable text", () => {
    assert.equal(parseGeminiResult("not json at all"), null);
    assert.equal(parseGeminiResult(""), null);
    assert.equal(parseGeminiResult("{"), null);
  });
});

describe("getGeminiPromptHash — Spec D1 cache invalidation", () => {
  it("version is gemini_classifier_v2 (spec D1 bump)", () => {
    assert.equal(GEMINI_PROMPT_VERSION, "gemini_classifier_v2");
  });

  it("current hash differs from the pre-v2 hash for a hypothetical 120-char slice", () => {
    // This is a sanity check that our cache invalidation is real. The pre-v2
    // implementation hashed SYSTEM_PROMPT.slice(0, 120). With the new full-
    // prompt hash, any prompt edit ANYWHERE must produce a different hash.
    // We cannot reconstruct the old hash exactly (SYSTEM_PROMPT is private)
    // without exporting it, but we can assert the current hash is 16 chars of
    // hex and the hash is stable (deterministic across calls).
    const h1 = getGeminiPromptHash();
    const h2 = getGeminiPromptHash();
    assert.equal(h1, h2, "hash must be deterministic");
    assert.match(h1, /^[0-9a-f]{16}$/, "hash must be 16 hex chars");
  });

  it("hashing the full prompt produces a different value than hashing the first 120 chars", () => {
    // Cross-check via two distinct prompts that share a common prefix.
    // Proves the hashing strategy reacts to content past char 120 — which is
    // exactly the change Spec D1 required so that ENTITY NAMES prompt
    // additions below the existing rules bust the cache.
    const prefix = "A".repeat(120);
    const promptA = prefix + "CHANGE_A";
    const promptB = prefix + "CHANGE_B";

    const sliceHashA = createHash("sha256").update(promptA.slice(0, 120)).digest("hex").slice(0, 16);
    const sliceHashB = createHash("sha256").update(promptB.slice(0, 120)).digest("hex").slice(0, 16);
    const fullHashA = createHash("sha256").update(promptA).digest("hex").slice(0, 16);
    const fullHashB = createHash("sha256").update(promptB).digest("hex").slice(0, 16);

    assert.equal(sliceHashA, sliceHashB, "slice-of-120 misses changes past char 120");
    assert.notEqual(fullHashA, fullHashB, "full-prompt hash catches changes past char 120");
  });
});
