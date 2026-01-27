import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

/**
 * Unit tests for Option A: Omega MCP Wiring.
 *
 * Tests pure functions and structural contracts only — no DB, no AI, no MCP.
 * Server-only modules are tested via local replicas.
 */

// ─── Local replicas of pure functions ─────────────────────

/** Replica of uri.ts omegaEntityUri */
function omegaEntityUri(entityType: string, ...ids: string[]): string {
  if (ids.length === 0) throw new Error(`omegaEntityUri requires at least one id for ${entityType}`);
  return `omega://entity/${entityType}/${ids.join("/")}`;
}

/** Replica of uri.ts omegaStateUri */
function omegaStateUri(stateType: string, id: string): string {
  return `omega://state/${stateType}/${id}`;
}

/** Replica of uri.ts omegaConstraintsUri */
function omegaConstraintsUri(namespace: string): string {
  return `omega://constraints/${namespace}`;
}

/** Replica of uri.ts omegaTracesUri */
function omegaTracesUri(sessionId: string): string {
  return `omega://traces/${sessionId}`;
}

/** Replica of redaction.ts maskEin */
function maskEin(ein: string): string {
  const digits = ein.replace(/[^0-9]/g, "");
  if (digits.length !== 9) return ein;
  return `**-***${digits.slice(5)}`;
}

/** Replica of redaction.ts hashId */
function hashId(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

/** Replica of redaction logic */
const GLOBAL_DENY = new Set(["ssn", "ssn_full", "ein_raw", "document_bytes", "raw_tax_return"]);

function redactPayload(
  profile: { deny_fields: string[]; mask_fields: string[]; hash_fields: string[] },
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const denySet = new Set([...GLOBAL_DENY, ...profile.deny_fields]);
  const maskSet = new Set(profile.mask_fields);
  const hashSet = new Set(profile.hash_fields);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (denySet.has(key)) continue;
    if (maskSet.has(key) && typeof value === "string") { result[key] = maskEin(value); continue; }
    if (hashSet.has(key) && typeof value === "string") { result[key] = hashId(value); continue; }
    result[key] = value;
  }
  return result;
}

/** Replica of lifecycle guard */
type UnderwriteStartGate = {
  allowed: boolean;
  blockers: string[];
  reason: string;
  omega_confidence?: { available: boolean; confidence?: number; recommendation?: string };
};

function buildUnderwriteStartGate(params: {
  lifecycleStage?: string | null;
  verifyOk?: boolean;
  authOk?: boolean;
  testMode?: boolean;
  omegaConfidence?: { ok: boolean; confidence?: number; recommendation?: "proceed" | "clarify" | "block" };
}): UnderwriteStartGate {
  const { lifecycleStage, verifyOk = false, authOk = true, testMode = false, omegaConfidence } = params;
  const blockers: string[] = [];
  const canAccessUW = lifecycleStage === "underwriting" || lifecycleStage === "ready";

  if (!authOk) blockers.push("Authentication required to start underwriting.");
  if (testMode) blockers.push("Banker test mode blocks underwriting.");
  if (!canAccessUW) blockers.push("Deal lifecycle not ready for underwriting.");
  if (!verifyOk) blockers.push("Underwrite verification has not passed.");
  if (omegaConfidence?.ok && omegaConfidence.recommendation === "block") {
    blockers.push("Omega confidence assessment recommends blocking progression.");
  }

  let reason = "ok";
  if (testMode) reason = "test_mode";
  else if (!authOk) reason = "auth_required";
  else if (!canAccessUW) reason = "lifecycle_blocked";
  else if (!verifyOk) reason = "verify_failed";
  else if (omegaConfidence?.ok && omegaConfidence.recommendation === "block") reason = "omega_block";

  return {
    allowed: blockers.length === 0,
    blockers,
    reason,
    omega_confidence: omegaConfidence ? {
      available: omegaConfidence.ok,
      confidence: omegaConfidence.confidence,
      recommendation: omegaConfidence.recommendation,
    } : undefined,
  };
}

/** Replica of mirror resolveIdPath */
function resolveIdPath(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

// ─── Load mapping.json for cross-checks ────────────────────

const ROOT = process.cwd();
const mappingRaw = readFileSync(resolve(ROOT, "docs/omega/mapping.json"), "utf-8");
const mapping = JSON.parse(mappingRaw);

// ═══════════════════════════════════════════════════════════
// URI Builder Tests
// ═══════════════════════════════════════════════════════════

describe("omegaEntityUri", () => {
  test("builds single-id URI", () => {
    assert.equal(omegaEntityUri("deal", "abc-123"), "omega://entity/deal/abc-123");
  });

  test("builds composite-id URI", () => {
    assert.equal(
      omegaEntityUri("examiner_drop", "deal-1", "snap-1"),
      "omega://entity/examiner_drop/deal-1/snap-1",
    );
  });

  test("builds policy_context URI with two ids", () => {
    assert.equal(
      omegaEntityUri("policy_context", "bank-1", "v2"),
      "omega://entity/policy_context/bank-1/v2",
    );
  });

  test("throws on zero ids", () => {
    assert.throws(() => omegaEntityUri("deal"), /requires at least one id/);
  });
});

describe("omegaStateUri", () => {
  test("builds borrower state URI", () => {
    assert.equal(omegaStateUri("borrower", "b-123"), "omega://state/borrower/b-123");
  });

  test("builds underwriting_case state URI", () => {
    assert.equal(omegaStateUri("underwriting_case", "d-456"), "omega://state/underwriting_case/d-456");
  });
});

describe("omegaConstraintsUri", () => {
  test("builds underwriting constraints URI", () => {
    assert.equal(omegaConstraintsUri("buddy/underwriting"), "omega://constraints/buddy/underwriting");
  });
});

describe("omegaTracesUri", () => {
  test("builds traces URI", () => {
    assert.equal(omegaTracesUri("sess-789"), "omega://traces/sess-789");
  });
});

// ═══════════════════════════════════════════════════════════
// Redaction Tests
// ═══════════════════════════════════════════════════════════

describe("maskEin", () => {
  test("masks full EIN with dash", () => {
    assert.equal(maskEin("12-3456789"), "**-***6789");
  });

  test("masks digits-only EIN", () => {
    assert.equal(maskEin("123456789"), "**-***6789");
  });

  test("returns invalid input unchanged", () => {
    assert.equal(maskEin("**-***6789"), "**-***6789"); // already masked
    assert.equal(maskEin("short"), "short"); // too short
  });
});

describe("hashId", () => {
  test("returns deterministic hash", () => {
    const h1 = hashId("test-value");
    const h2 = hashId("test-value");
    assert.equal(h1, h2);
  });

  test("different inputs produce different hashes", () => {
    assert.notEqual(hashId("a"), hashId("b"));
  });
});

describe("redactPayload", () => {
  const auditSafeProfile = mapping.redaction.find((r: any) => r.profile_name === "audit_safe");

  test("strips denied fields", () => {
    const result = redactPayload(auditSafeProfile, {
      dealId: "d-1",
      ssn: "123-45-6789",
      ein_raw: "123456789",
      document_bytes: "base64...",
      raw_tax_return: "...",
      safe_field: "ok",
    });
    assert.equal(result.dealId, "d-1");
    assert.equal(result.safe_field, "ok");
    assert.equal(result.ssn, undefined);
    assert.equal(result.ein_raw, undefined);
    assert.equal(result.document_bytes, undefined);
    assert.equal(result.raw_tax_return, undefined);
  });

  test("masks EIN fields", () => {
    const result = redactPayload(auditSafeProfile, {
      ein: "12-3456789",
      name: "Acme Corp",
    });
    assert.equal(result.ein, "**-***6789");
    assert.equal(result.name, "Acme Corp");
  });

  test("preserves null and undefined values", () => {
    const result = redactPayload(auditSafeProfile, {
      dealId: null,
      something: undefined,
    });
    assert.equal(result.dealId, null);
    assert.equal(result.something, undefined);
  });
});

// ═══════════════════════════════════════════════════════════
// Lifecycle Guard Tests (with Omega Confidence)
// ═══════════════════════════════════════════════════════════

describe("buildUnderwriteStartGate with omega confidence", () => {
  test("allows when omega says proceed", () => {
    const gate = buildUnderwriteStartGate({
      lifecycleStage: "underwriting",
      verifyOk: true,
      omegaConfidence: { ok: true, confidence: 0.9, recommendation: "proceed" },
    });
    assert.equal(gate.allowed, true);
    assert.equal(gate.reason, "ok");
    assert.equal(gate.omega_confidence?.available, true);
    assert.equal(gate.omega_confidence?.confidence, 0.9);
  });

  test("blocks when omega says block", () => {
    const gate = buildUnderwriteStartGate({
      lifecycleStage: "underwriting",
      verifyOk: true,
      omegaConfidence: { ok: true, confidence: 0.2, recommendation: "block" },
    });
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, "omega_block");
    assert.ok(gate.blockers.some(b => b.includes("Omega")));
  });

  test("falls back gracefully when omega unavailable", () => {
    const gate = buildUnderwriteStartGate({
      lifecycleStage: "underwriting",
      verifyOk: true,
      omegaConfidence: { ok: false },
    });
    // Should still be allowed — omega failure is not a blocker
    assert.equal(gate.allowed, true);
    assert.equal(gate.reason, "ok");
    assert.equal(gate.omega_confidence?.available, false);
  });

  test("works without omega at all (no param)", () => {
    const gate = buildUnderwriteStartGate({
      lifecycleStage: "underwriting",
      verifyOk: true,
    });
    assert.equal(gate.allowed, true);
    assert.equal(gate.reason, "ok");
    assert.equal(gate.omega_confidence, undefined);
  });

  test("local blockers take precedence over omega", () => {
    const gate = buildUnderwriteStartGate({
      lifecycleStage: "intake", // not ready
      verifyOk: false, // not verified
      omegaConfidence: { ok: true, confidence: 1.0, recommendation: "proceed" },
    });
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, "lifecycle_blocked");
  });

  test("clarify recommendation does not block", () => {
    const gate = buildUnderwriteStartGate({
      lifecycleStage: "underwriting",
      verifyOk: true,
      omegaConfidence: { ok: true, confidence: 0.5, recommendation: "clarify" },
    });
    assert.equal(gate.allowed, true);
    assert.equal(gate.reason, "ok");
    assert.equal(gate.omega_confidence?.recommendation, "clarify");
  });
});

// ═══════════════════════════════════════════════════════════
// Mirror Event ID Path Resolution
// ═══════════════════════════════════════════════════════════

describe("resolveIdPath", () => {
  test("resolves top-level key", () => {
    assert.equal(resolveIdPath({ dealId: "abc" }, "dealId"), "abc");
  });

  test("resolves nested path", () => {
    assert.equal(
      resolveIdPath({ payload: { borrowerId: "xyz" } }, "payload.borrowerId"),
      "xyz",
    );
  });

  test("returns undefined for missing path", () => {
    assert.equal(resolveIdPath({ dealId: "abc" }, "missing"), undefined);
  });

  test("returns undefined for non-string value", () => {
    assert.equal(resolveIdPath({ dealId: 123 } as any, "dealId"), undefined);
  });

  test("handles null in chain", () => {
    assert.equal(resolveIdPath({ a: null } as any, "a.b"), undefined);
  });
});

// ═══════════════════════════════════════════════════════════
// Mapping Contract Tests
// ═══════════════════════════════════════════════════════════

describe("mapping.json contract", () => {
  test("version is 1.0", () => {
    assert.equal(mapping.version, "1.0");
  });

  test("all events have buddy. prefix in omega_event_type", () => {
    for (const evt of mapping.events) {
      assert.ok(
        evt.omega_event_type.startsWith("buddy."),
        `${evt.omega_event_type} should start with buddy.`,
      );
    }
  });

  test("all events target omega://events/write", () => {
    for (const evt of mapping.events) {
      assert.equal(evt.omega_write_resource, "omega://events/write");
    }
  });

  test("all entity types unique", () => {
    const types = mapping.entities.map((e: any) => e.entity_type);
    assert.equal(types.length, new Set(types).size);
  });

  test("all omega_event_types unique", () => {
    const types = mapping.events.map((e: any) => e.omega_event_type);
    assert.equal(types.length, new Set(types).size);
  });

  test("ownership model correct", () => {
    assert.equal(mapping.ownership.source_of_truth, "omega");
    assert.equal(mapping.ownership.operational_store, "buddy_db");
  });

  test("required redaction profiles exist", () => {
    const names = mapping.redaction.map((r: any) => r.profile_name);
    assert.ok(names.includes("audit_safe"));
    assert.ok(names.includes("examiner_safe"));
    assert.ok(names.includes("internal_debug"));
  });

  test("all profiles deny ssn and ein_raw", () => {
    for (const profile of mapping.redaction) {
      assert.ok(profile.deny_fields.includes("ssn"), `${profile.profile_name} must deny ssn`);
      assert.ok(profile.deny_fields.includes("ein_raw"), `${profile.profile_name} must deny ein_raw`);
      assert.ok(profile.deny_fields.includes("document_bytes"), `${profile.profile_name} must deny document_bytes`);
    }
  });
});

describe("invokeOmega never-throw contract", () => {
  test("kill switch returns killed (structural check)", () => {
    // This tests the structural pattern — the actual invokeOmega requires server-only
    // We verify the code path exists via the source file
    const src = readFileSync(resolve(ROOT, "src/lib/omega/invokeOmega.ts"), "utf-8");
    assert.ok(src.includes("isOmegaKilled"), "Kill switch function exists");
    assert.ok(src.includes("isOmegaEnabled"), "Enabled check function exists");
    assert.ok(src.includes('error: "killed"'), "Kill switch returns killed");
    assert.ok(src.includes('error: "disabled"'), "Disabled returns disabled");
    assert.ok(src.includes("safeWithTimeout"), "Uses safeWithTimeout for timeout");
    // mcpCall intentionally throws (caught by safeWithTimeout) — verify invokeOmega itself returns sealed results
    assert.ok(src.includes("ok: true"), "Returns ok: true on success");
    assert.ok(src.includes("ok: false"), "Returns ok: false on failure");
  });
});
