import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GatekeeperClassificationSchema, GatekeeperDocTypeEnum, DetectedSignalsSchema } from "../schema";

// ---------------------------------------------------------------------------
// Valid classification payloads
// ---------------------------------------------------------------------------

describe("GatekeeperClassificationSchema — valid payloads", () => {
  it("parses a valid BUSINESS_TAX_RETURN classification", () => {
    const input = {
      doc_type: "BUSINESS_TAX_RETURN",
      confidence: 0.95,
      tax_year: 2024,
      reasons: ["Form 1120S header detected", "EIN visible"],
      detected_signals: {
        form_numbers: ["1120S"],
        has_ein: true,
        has_ssn: false,
      },
    };
    const result = GatekeeperClassificationSchema.parse(input);
    assert.equal(result.doc_type, "BUSINESS_TAX_RETURN");
    assert.equal(result.confidence, 0.95);
    assert.equal(result.tax_year, 2024);
    assert.equal(result.reasons.length, 2);
    assert.deepEqual(result.detected_signals.form_numbers, ["1120S"]);
  });

  it("parses with null tax_year", () => {
    const input = {
      doc_type: "BANK_STATEMENT",
      confidence: 0.88,
      tax_year: null,
      reasons: ["Bank header detected"],
      detected_signals: {
        form_numbers: [],
        has_ein: false,
        has_ssn: false,
      },
    };
    const result = GatekeeperClassificationSchema.parse(input);
    assert.equal(result.tax_year, null);
  });

  it("parses with empty reasons array", () => {
    const input = {
      doc_type: "UNKNOWN",
      confidence: 0.1,
      tax_year: null,
      reasons: [],
      detected_signals: {
        form_numbers: [],
        has_ein: false,
        has_ssn: false,
      },
    };
    const result = GatekeeperClassificationSchema.parse(input);
    assert.equal(result.reasons.length, 0);
  });

  it("accepts confidence at boundary 0.0", () => {
    const input = {
      doc_type: "OTHER",
      confidence: 0.0,
      tax_year: null,
      reasons: [],
      detected_signals: { form_numbers: [], has_ein: false, has_ssn: false },
    };
    const result = GatekeeperClassificationSchema.parse(input);
    assert.equal(result.confidence, 0.0);
  });

  it("accepts confidence at boundary 1.0", () => {
    const input = {
      doc_type: "W2",
      confidence: 1.0,
      tax_year: 2023,
      reasons: ["W-2 header"],
      detected_signals: { form_numbers: ["W-2"], has_ein: true, has_ssn: true },
    };
    const result = GatekeeperClassificationSchema.parse(input);
    assert.equal(result.confidence, 1.0);
  });
});

// ---------------------------------------------------------------------------
// Invalid payloads
// ---------------------------------------------------------------------------

describe("GatekeeperClassificationSchema — invalid payloads", () => {
  it("rejects invalid doc_type", () => {
    const input = {
      doc_type: "INVALID_TYPE",
      confidence: 0.9,
      tax_year: null,
      reasons: [],
      detected_signals: { form_numbers: [], has_ein: false, has_ssn: false },
    };
    assert.throws(() => GatekeeperClassificationSchema.parse(input));
  });

  it("rejects confidence > 1.0", () => {
    const input = {
      doc_type: "OTHER",
      confidence: 1.5,
      tax_year: null,
      reasons: [],
      detected_signals: { form_numbers: [], has_ein: false, has_ssn: false },
    };
    assert.throws(() => GatekeeperClassificationSchema.parse(input));
  });

  it("rejects confidence < 0.0", () => {
    const input = {
      doc_type: "OTHER",
      confidence: -0.1,
      tax_year: null,
      reasons: [],
      detected_signals: { form_numbers: [], has_ein: false, has_ssn: false },
    };
    assert.throws(() => GatekeeperClassificationSchema.parse(input));
  });

  it("rejects missing detected_signals", () => {
    const input = {
      doc_type: "K1",
      confidence: 0.9,
      tax_year: 2024,
      reasons: ["Schedule K-1"],
    };
    assert.throws(() => GatekeeperClassificationSchema.parse(input));
  });

  it("rejects non-integer tax_year", () => {
    const input = {
      doc_type: "BUSINESS_TAX_RETURN",
      confidence: 0.9,
      tax_year: 2024.5,
      reasons: [],
      detected_signals: { form_numbers: [], has_ein: false, has_ssn: false },
    };
    assert.throws(() => GatekeeperClassificationSchema.parse(input));
  });

  it("rejects missing doc_type", () => {
    const input = {
      confidence: 0.9,
      tax_year: null,
      reasons: [],
      detected_signals: { form_numbers: [], has_ein: false, has_ssn: false },
    };
    assert.throws(() => GatekeeperClassificationSchema.parse(input));
  });
});

// ---------------------------------------------------------------------------
// DocType enum
// ---------------------------------------------------------------------------

describe("GatekeeperDocTypeEnum", () => {
  it("accepts all 11 valid doc types", () => {
    const types = [
      "BUSINESS_TAX_RETURN", "PERSONAL_TAX_RETURN", "W2", "FORM_1099", "K1",
      "BANK_STATEMENT", "FINANCIAL_STATEMENT", "DRIVERS_LICENSE", "VOIDED_CHECK",
      "OTHER", "UNKNOWN",
    ];
    for (const t of types) {
      assert.equal(GatekeeperDocTypeEnum.parse(t), t);
    }
  });

  it("rejects invalid type", () => {
    assert.throws(() => GatekeeperDocTypeEnum.parse("NOT_A_TYPE"));
  });
});

// ---------------------------------------------------------------------------
// DetectedSignals
// ---------------------------------------------------------------------------

describe("DetectedSignalsSchema", () => {
  it("parses valid signals", () => {
    const result = DetectedSignalsSchema.parse({
      form_numbers: ["1040", "W-2"],
      has_ein: true,
      has_ssn: true,
    });
    assert.deepEqual(result.form_numbers, ["1040", "W-2"]);
    assert.equal(result.has_ein, true);
  });

  it("rejects missing has_ssn", () => {
    assert.throws(() =>
      DetectedSignalsSchema.parse({
        form_numbers: [],
        has_ein: false,
      }),
    );
  });
});
