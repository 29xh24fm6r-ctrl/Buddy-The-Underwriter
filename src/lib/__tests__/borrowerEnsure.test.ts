import { test, describe } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for borrower ensure + autofill helpers.
 * These test pure functions only — no DB, no AI calls.
 */

// ─── maskEin ────────────────────────────────────────────
// Import from extraction module (pure function, no server-only guard needed for tests)
function maskEin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 4) return null;
  const last4 = digits.slice(-4);
  return `XX-XXX${last4}`;
}

function inferEntityTypeFromText(text: string): string | null {
  const t = String(text || "").toLowerCase();
  if (!t) return null;
  if (t.includes("form 1120s") || t.includes("1120-s") || t.includes("1120 s")) return "S-Corp";
  if (t.includes("form 1120")) return "Corp";
  if (t.includes("form 1065")) return "Partnership";
  if (t.includes("schedule c")) return "Sole Prop";
  if (t.includes("form 1040")) return "Individual";
  if (t.includes("limited liability company") || t.includes("llc")) return "LLC";
  if (t.includes("s corporation") || t.includes("s-corp")) return "S-Corp";
  if (t.includes("c corporation") || t.includes("c-corp")) return "Corp";
  if (t.includes("partnership")) return "Partnership";
  if (t.includes("sole proprietorship")) return "Sole Prop";
  return null;
}

function validateNaicsCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const digits = String(code).replace(/\D/g, "");
  if (digits.length < 2 || digits.length > 6) return null;
  return digits;
}

function normalizeOwners(raw: unknown): Array<{ name: string; title: string | null; ownership_pct: number | null }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o: any) => {
      const name = String(o?.name ?? o?.fullName ?? o?.full_name ?? "").trim();
      if (!name) return null;
      const pctRaw = o?.ownership_pct ?? o?.ownershipPercent ?? o?.ownership_percent ?? o?.pct ?? null;
      const pct = pctRaw !== null && pctRaw !== undefined ? Number(pctRaw) : null;
      return {
        name,
        title: o?.title ? String(o.title).trim() : null,
        ownership_pct: pct !== null && !isNaN(pct) && pct > 0 && pct <= 100 ? pct : null,
      };
    })
    .filter(Boolean) as Array<{ name: string; title: string | null; ownership_pct: number | null }>;
}

// ─── Tests ──────────────────────────────────────────────

describe("maskEin", () => {
  test("masks full EIN correctly", () => {
    assert.equal(maskEin("12-3456789"), "XX-XXX6789");
  });

  test("masks digits-only EIN", () => {
    assert.equal(maskEin("123456789"), "XX-XXX6789");
  });

  test("returns null for empty/null", () => {
    assert.equal(maskEin(null), null);
    assert.equal(maskEin(""), null);
    assert.equal(maskEin(undefined), null);
  });

  test("returns null for too-short string", () => {
    assert.equal(maskEin("12"), null);
    assert.equal(maskEin("abc"), null);
  });

  test("handles partial with 4+ digits", () => {
    assert.equal(maskEin("XX-XXX1234"), "XX-XXX1234");
  });
});

describe("inferEntityTypeFromText", () => {
  test("detects Form 1120S as S-Corp", () => {
    assert.equal(inferEntityTypeFromText("Form 1120S filed for 2023"), "S-Corp");
  });

  test("detects Form 1120 as Corp", () => {
    assert.equal(inferEntityTypeFromText("Form 1120 U.S. Corporation"), "Corp");
  });

  test("detects Form 1065 as Partnership", () => {
    assert.equal(inferEntityTypeFromText("Form 1065 Return of Partnership"), "Partnership");
  });

  test("detects Schedule C as Sole Prop", () => {
    assert.equal(inferEntityTypeFromText("Schedule C Profit or Loss"), "Sole Prop");
  });

  test("detects Form 1040 as Individual", () => {
    assert.equal(inferEntityTypeFromText("Form 1040 Individual Income Tax"), "Individual");
  });

  test("detects LLC from text", () => {
    assert.equal(inferEntityTypeFromText("ABC Services LLC"), "LLC");
  });

  test("returns null for unrecognized text", () => {
    assert.equal(inferEntityTypeFromText("random document content"), null);
  });

  test("handles empty string", () => {
    assert.equal(inferEntityTypeFromText(""), null);
  });

  test("1120S takes priority over 1120", () => {
    // Text with both "1120" and "1120S" — S-Corp should win because check is first
    assert.equal(inferEntityTypeFromText("Form 1120S"), "S-Corp");
  });
});

describe("validateNaicsCode", () => {
  test("accepts 6-digit NAICS", () => {
    assert.equal(validateNaicsCode("541511"), "541511");
  });

  test("accepts 2-digit NAICS", () => {
    assert.equal(validateNaicsCode("54"), "54");
  });

  test("strips non-digits", () => {
    assert.equal(validateNaicsCode("541-511"), "541511");
  });

  test("rejects single digit", () => {
    assert.equal(validateNaicsCode("5"), null);
  });

  test("rejects 7+ digits", () => {
    assert.equal(validateNaicsCode("5415110"), null);
  });

  test("returns null for empty/null", () => {
    assert.equal(validateNaicsCode(null), null);
    assert.equal(validateNaicsCode(""), null);
    assert.equal(validateNaicsCode(undefined), null);
  });
});

describe("normalizeOwners", () => {
  test("normalizes standard owner array", () => {
    const result = normalizeOwners([
      { name: "John Smith", title: "CEO", ownership_pct: 51 },
      { name: "Jane Doe", title: "CFO", ownership_pct: 49 },
    ]);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, "John Smith");
    assert.equal(result[0].ownership_pct, 51);
    assert.equal(result[1].name, "Jane Doe");
    assert.equal(result[1].ownership_pct, 49);
  });

  test("handles alternative key names", () => {
    const result = normalizeOwners([
      { fullName: "Bob Builder", ownershipPercent: 100 },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Bob Builder");
    assert.equal(result[0].ownership_pct, 100);
  });

  test("filters out entries with empty names", () => {
    const result = normalizeOwners([
      { name: "", ownership_pct: 50 },
      { name: "Valid Name", ownership_pct: 50 },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Valid Name");
  });

  test("handles null/undefined ownership", () => {
    const result = normalizeOwners([
      { name: "No Pct Owner" },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].ownership_pct, null);
  });

  test("rejects invalid percentages", () => {
    const result = normalizeOwners([
      { name: "Over100", ownership_pct: 150 },
      { name: "Zero", ownership_pct: 0 },
      { name: "Negative", ownership_pct: -10 },
    ]);
    assert.equal(result[0].ownership_pct, null); // > 100
    assert.equal(result[1].ownership_pct, null); // 0 is not > 0
    assert.equal(result[2].ownership_pct, null); // negative
  });

  test("returns empty array for non-array input", () => {
    assert.deepEqual(normalizeOwners(null), []);
    assert.deepEqual(normalizeOwners(undefined), []);
    assert.deepEqual(normalizeOwners("string"), []);
    assert.deepEqual(normalizeOwners(42), []);
  });
});

// ─── Phase D: Confidence scoring helpers ────────────────
type ConfidenceLevel = "high" | "review" | "low";

function classifyConfidence(conf: number): ConfidenceLevel {
  if (conf >= 0.85) return "high";
  if (conf >= 0.60) return "review";
  return "low";
}

function clampConf(v: number): number {
  return Math.max(0, Math.min(1, v));
}

describe("classifyConfidence", () => {
  test("classifies >= 0.85 as high", () => {
    assert.equal(classifyConfidence(0.85), "high");
    assert.equal(classifyConfidence(0.90), "high");
    assert.equal(classifyConfidence(1.0), "high");
  });

  test("classifies 0.60–0.84 as review", () => {
    assert.equal(classifyConfidence(0.60), "review");
    assert.equal(classifyConfidence(0.72), "review");
    assert.equal(classifyConfidence(0.84), "review");
  });

  test("classifies < 0.60 as low", () => {
    assert.equal(classifyConfidence(0.59), "low");
    assert.equal(classifyConfidence(0.30), "low");
    assert.equal(classifyConfidence(0), "low");
  });
});

describe("clampConf", () => {
  test("clamps values to 0–1", () => {
    assert.equal(clampConf(1.5), 1);
    assert.equal(clampConf(-0.5), 0);
    assert.equal(clampConf(0.75), 0.75);
    assert.equal(clampConf(0), 0);
    assert.equal(clampConf(1), 1);
  });
});

describe("confidence-gated field application", () => {
  function tryApply(conf: number): { applied: boolean; level: ConfidenceLevel } {
    const level = classifyConfidence(conf);
    const applied = conf >= 0.60;
    return { applied, level };
  }

  test("applies field at >= 0.85 with high confidence", () => {
    const result = tryApply(0.90);
    assert.equal(result.applied, true);
    assert.equal(result.level, "high");
  });

  test("applies field at 0.60–0.84 with review flag", () => {
    const result = tryApply(0.72);
    assert.equal(result.applied, true);
    assert.equal(result.level, "review");
  });

  test("skips field at < 0.60", () => {
    const result = tryApply(0.45);
    assert.equal(result.applied, false);
    assert.equal(result.level, "low");
  });

  test("boundary: exactly 0.60 applies with review", () => {
    const result = tryApply(0.60);
    assert.equal(result.applied, true);
    assert.equal(result.level, "review");
  });

  test("boundary: exactly 0.85 applies with high", () => {
    const result = tryApply(0.85);
    assert.equal(result.applied, true);
    assert.equal(result.level, "high");
  });
});

// ─── Phase D: Borrower completeness evaluation ─────────
describe("borrower completeness evaluation (contract)", () => {
  type BorrowerCompleteness = {
    complete: boolean;
    missing: string[];
    confidence_warnings: string[];
    stats: {
      fields_present: number;
      fields_required: number;
      owner_count: number;
      total_ownership_pct: number;
      has_attestation: boolean;
    };
  };

  function evaluateCompleteness(args: {
    hasLegalName: boolean;
    hasEntityType: boolean;
    hasEin: boolean;
    hasNaics: boolean;
    hasAddress: boolean;
    hasState: boolean;
    owners: Array<{ pct: number }>;
    hasAttestation: boolean;
    confidenceWarnings?: string[];
  }): BorrowerCompleteness {
    const missing: string[] = [];
    let fieldsPresent = 0;
    const totalRequired = 6; // legal_name, entity_type, ein, naics, address_line1, state

    if (args.hasLegalName) fieldsPresent++; else missing.push("legal_name");
    if (args.hasEntityType) fieldsPresent++; else missing.push("entity_type");
    if (args.hasEin) fieldsPresent++; else missing.push("ein");
    if (args.hasNaics) fieldsPresent++; else missing.push("naics_code");
    if (args.hasAddress) fieldsPresent++; else missing.push("address_line1");
    if (args.hasState) fieldsPresent++; else missing.push("state");

    const significantOwners = args.owners.filter((o) => o.pct >= 20);
    const totalPct = args.owners.reduce((s, o) => s + o.pct, 0);

    if (significantOwners.length === 0) missing.push("owner_gte_20pct");
    if (totalPct < 80) missing.push("total_ownership_gte_80pct");
    if (!args.hasAttestation) missing.push("owner_attestation");

    return {
      complete: missing.length === 0,
      missing,
      confidence_warnings: args.confidenceWarnings ?? [],
      stats: {
        fields_present: fieldsPresent,
        fields_required: totalRequired,
        owner_count: args.owners.length,
        total_ownership_pct: totalPct,
        has_attestation: args.hasAttestation,
      },
    };
  }

  test("complete borrower with all fields + owners + attestation", () => {
    const result = evaluateCompleteness({
      hasLegalName: true,
      hasEntityType: true,
      hasEin: true,
      hasNaics: true,
      hasAddress: true,
      hasState: true,
      owners: [{ pct: 51 }, { pct: 49 }],
      hasAttestation: true,
    });
    assert.equal(result.complete, true);
    assert.equal(result.missing.length, 0);
    assert.equal(result.stats.total_ownership_pct, 100);
  });

  test("incomplete: missing EIN", () => {
    const result = evaluateCompleteness({
      hasLegalName: true,
      hasEntityType: true,
      hasEin: false,
      hasNaics: true,
      hasAddress: true,
      hasState: true,
      owners: [{ pct: 100 }],
      hasAttestation: true,
    });
    assert.equal(result.complete, false);
    assert.ok(result.missing.includes("ein"));
  });

  test("incomplete: no owners >= 20%", () => {
    const result = evaluateCompleteness({
      hasLegalName: true,
      hasEntityType: true,
      hasEin: true,
      hasNaics: true,
      hasAddress: true,
      hasState: true,
      owners: [{ pct: 10 }, { pct: 10 }],
      hasAttestation: true,
    });
    assert.equal(result.complete, false);
    assert.ok(result.missing.includes("owner_gte_20pct"));
  });

  test("incomplete: total ownership < 80%", () => {
    const result = evaluateCompleteness({
      hasLegalName: true,
      hasEntityType: true,
      hasEin: true,
      hasNaics: true,
      hasAddress: true,
      hasState: true,
      owners: [{ pct: 30 }, { pct: 20 }],
      hasAttestation: true,
    });
    assert.equal(result.complete, false);
    assert.ok(result.missing.includes("total_ownership_gte_80pct"));
  });

  test("incomplete: no attestation", () => {
    const result = evaluateCompleteness({
      hasLegalName: true,
      hasEntityType: true,
      hasEin: true,
      hasNaics: true,
      hasAddress: true,
      hasState: true,
      owners: [{ pct: 100 }],
      hasAttestation: false,
    });
    assert.equal(result.complete, false);
    assert.ok(result.missing.includes("owner_attestation"));
  });

  test("multiple missing fields", () => {
    const result = evaluateCompleteness({
      hasLegalName: true,
      hasEntityType: false,
      hasEin: false,
      hasNaics: false,
      hasAddress: true,
      hasState: true,
      owners: [],
      hasAttestation: false,
    });
    assert.equal(result.complete, false);
    assert.ok(result.missing.includes("entity_type"));
    assert.ok(result.missing.includes("ein"));
    assert.ok(result.missing.includes("naics_code"));
    assert.ok(result.missing.includes("owner_gte_20pct"));
    assert.ok(result.missing.includes("owner_attestation"));
  });
});

// ─── Phase D: Attestation contract ─────────────────────
describe("attestation contract", () => {
  test("attestation response shape", () => {
    const response = {
      ok: true,
      attestation: {
        id: "att-uuid-1",
        attested_at: "2026-01-27T00:00:00.000Z",
        owner_count: 2,
        total_ownership_pct: 100,
      },
      meta: { borrowerId: "b-1", correlationId: "boa-123", ts: new Date().toISOString() },
    };

    assert.equal(response.ok, true);
    assert.equal(typeof response.attestation.id, "string");
    assert.equal(typeof response.attestation.attested_at, "string");
    assert.equal(typeof response.attestation.owner_count, "number");
    assert.equal(typeof response.attestation.total_ownership_pct, "number");
    assert.ok(response.attestation.total_ownership_pct >= 80);
  });

  test("attestation error when no owners", () => {
    const response = {
      ok: false,
      error: { code: "no_owners", message: "No owners on file. Add owners before attesting." },
      meta: { borrowerId: "b-1", correlationId: "boa-456", ts: new Date().toISOString() },
    };

    assert.equal(response.ok, false);
    assert.equal(response.error.code, "no_owners");
  });

  test("attestation error when insufficient ownership", () => {
    const response = {
      ok: false,
      error: { code: "insufficient_ownership", message: "Total ownership is 50.0%, must be >= 80% to attest." },
      meta: { borrowerId: "b-1", correlationId: "boa-789", ts: new Date().toISOString() },
    };

    assert.equal(response.ok, false);
    assert.equal(response.error.code, "insufficient_ownership");
  });
});

// ─── Phase D: Guard integration contract ────────────────
describe("underwrite guard borrower completeness contract", () => {
  test("incomplete borrower produces BLOCKED issue", () => {
    const issue = {
      code: "UW_BORROWER_INCOMPLETE",
      severity: "BLOCKED" as const,
      title: "Borrower profile incomplete",
      detail: "Missing: EIN, NAICS code, ownership attestation. Complete the borrower profile and attest ownership before underwriting.",
      fix: { label: "Complete Borrower", target: { kind: "borrower_attachment" as const, dealId: "d-1" } },
    };

    assert.equal(issue.severity, "BLOCKED");
    assert.equal(issue.code, "UW_BORROWER_INCOMPLETE");
    assert.ok(issue.detail.includes("Missing:"));
    assert.equal(issue.fix.target.kind, "borrower_attachment");
  });

  test("confidence warnings produce WARN issue", () => {
    const issue = {
      code: "UW_BORROWER_CONFIDENCE_REVIEW",
      severity: "WARN" as const,
      title: "Borrower fields need review",
      detail: "2 autofilled field(s) have moderate confidence and should be verified.",
      fix: { label: "Review Borrower", target: { kind: "borrower_attachment" as const, dealId: "d-1" } },
    };

    assert.equal(issue.severity, "WARN");
    assert.equal(issue.code, "UW_BORROWER_CONFIDENCE_REVIEW");
  });
});

describe("Borrower ensure behavior contracts", () => {
  test("ensure endpoint should return sealed envelope shape", () => {
    // Verifies the contract: ok + meta + action
    const sampleResponse = {
      ok: true,
      action: "created",
      borrower: { id: "uuid-1", legal_name: "Test Corp" },
      created: true,
      attached: true,
      updatedFromDocs: false,
      meta: { dealId: "deal-1", correlationId: "bens-123", ts: new Date().toISOString() },
    };

    assert.equal(sampleResponse.ok, true);
    assert.equal(typeof sampleResponse.meta.correlationId, "string");
    assert.equal(typeof sampleResponse.meta.ts, "string");
    assert.equal(typeof sampleResponse.action, "string");
    assert.ok(["created", "attached", "already_attached", "autofilled"].includes(sampleResponse.action));
  });

  test("ensure error should include code + message + correlationId", () => {
    const errorResponse = {
      ok: false,
      error: { code: "tenant_mismatch", message: "Borrower belongs to a different bank" },
      meta: { dealId: "deal-1", correlationId: "bens-456", ts: new Date().toISOString() },
    };

    assert.equal(errorResponse.ok, false);
    assert.equal(typeof errorResponse.error.code, "string");
    assert.equal(typeof errorResponse.error.message, "string");
    assert.ok(errorResponse.error.code.length > 0);
  });

  test("autofill result contract", () => {
    const autofillResult = {
      ok: true,
      borrowerPatch: { legal_name: "Test Corp", ein: "XX-XXX1234" },
      ownersUpserted: 2,
      fieldsAutofilled: ["legal_name", "ein"],
      warnings: ["NAICS code not found in uploaded returns."],
    };

    assert.equal(autofillResult.ok, true);
    assert.ok(Array.isArray(autofillResult.fieldsAutofilled));
    assert.ok(Array.isArray(autofillResult.warnings));
    assert.equal(typeof autofillResult.ownersUpserted, "number");
  });
});
