/**
 * Override Intelligence — CI-Blocking Integrity Guards (Phase B)
 *
 * 9 guards that protect core override intelligence safety properties:
 *   1. isOverrideIntelligenceEnabled() → false when env var absent
 *   2. isOverrideIntelligenceEnabled() → false when set to "0" or "false"
 *   3. computeOverrideFingerprint is deterministic — same input → identical hash
 *   4. computeOverrideFingerprint produces different fingerprint for different (from, to)
 *   5. generateGoldenTest returns ONLY test.skip() stubs — never test() [CI-BLOCKING]
 *   6. generateGoldenTest deduplicates identical (from, to) clusters, keeps highest count
 *   7. generateGoldenTest returns empty string when no clusters meet minOverrideCount
 *   8. computeOverrideFingerprint output starts with "override_v1" prefix
 *   9. generateGoldenTest header includes GENERATED_AT and fingerprint reference
 *
 * Pure function tests — no DB, no IO, no server-only imports.
 * Imports only from computeOverrideFingerprint.ts, generateGoldenTest.ts, flags/overrideIntelligence.ts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeOverrideFingerprint,
  bucketConfidence,
} from "../computeOverrideFingerprint";
import { generateGoldenTest, type ClusterInput } from "../generateGoldenTest";
import { isOverrideIntelligenceEnabled } from "../../../flags/overrideIntelligence";

// ---------------------------------------------------------------------------
// Guard 1: isOverrideIntelligenceEnabled() → false when env var absent
// ---------------------------------------------------------------------------

test("Guard 1: isOverrideIntelligenceEnabled() → false when ENABLE_OVERRIDE_INTELLIGENCE absent", () => {
  const originalVal = process.env.ENABLE_OVERRIDE_INTELLIGENCE;
  delete process.env.ENABLE_OVERRIDE_INTELLIGENCE;

  assert.strictEqual(
    isOverrideIntelligenceEnabled(),
    false,
    "Flag must be false when ENABLE_OVERRIDE_INTELLIGENCE is not set",
  );

  // Restore
  if (originalVal === undefined) {
    delete process.env.ENABLE_OVERRIDE_INTELLIGENCE;
  } else {
    process.env.ENABLE_OVERRIDE_INTELLIGENCE = originalVal;
  }

  console.log(`[overrideIntegrityGuard] Guard 1: flag=false when absent ✓`);
});

// ---------------------------------------------------------------------------
// Guard 2: isOverrideIntelligenceEnabled() → false when set to "0" or "false"
// ---------------------------------------------------------------------------

test("Guard 2: isOverrideIntelligenceEnabled() → false when set to '0' or 'false', true when 'true'", () => {
  const originalVal = process.env.ENABLE_OVERRIDE_INTELLIGENCE;

  process.env.ENABLE_OVERRIDE_INTELLIGENCE = "false";
  assert.strictEqual(
    isOverrideIntelligenceEnabled(),
    false,
    "Flag must be false when ENABLE_OVERRIDE_INTELLIGENCE=false",
  );

  process.env.ENABLE_OVERRIDE_INTELLIGENCE = "0";
  assert.strictEqual(
    isOverrideIntelligenceEnabled(),
    false,
    "Flag must be false when ENABLE_OVERRIDE_INTELLIGENCE=0",
  );

  process.env.ENABLE_OVERRIDE_INTELLIGENCE = "true";
  assert.strictEqual(
    isOverrideIntelligenceEnabled(),
    true,
    "Flag must be true when ENABLE_OVERRIDE_INTELLIGENCE=true",
  );

  // Restore
  if (originalVal === undefined) {
    delete process.env.ENABLE_OVERRIDE_INTELLIGENCE;
  } else {
    process.env.ENABLE_OVERRIDE_INTELLIGENCE = originalVal;
  }

  console.log(`[overrideIntegrityGuard] Guard 2: flag correctly gated ✓`);
});

// ---------------------------------------------------------------------------
// Guard 3: computeOverrideFingerprint is deterministic
// ---------------------------------------------------------------------------

test("Guard 3: computeOverrideFingerprint is deterministic — same input produces identical hash twice", () => {
  const input = {
    fromType: "FINANCIAL_STATEMENT",
    toType: "INCOME_STATEMENT",
    confidenceBucket: bucketConfidence(0.78),
    classifierSource: "Rules",
    classificationVersion: "v2.1",
  } as const;

  const hash1 = computeOverrideFingerprint(input);
  const hash2 = computeOverrideFingerprint(input);

  assert.strictEqual(
    hash1,
    hash2,
    "Same input must produce identical hash on every call",
  );
  assert.strictEqual(hash1.length, 64, "SHA-256 hex output must be 64 chars");

  console.log(
    `[overrideIntegrityGuard] Guard 3: deterministic hash=${hash1.slice(0, 16)}... ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 4: Different (from, to) pairs produce different fingerprints
// ---------------------------------------------------------------------------

test("Guard 4: computeOverrideFingerprint produces different fingerprint for different (from, to) pairs", () => {
  const base = {
    confidenceBucket: bucketConfidence(0.85),
    classifierSource: "Gemini",
    classificationVersion: "v2.1",
  } as const;

  const hash1 = computeOverrideFingerprint({
    fromType: "FINANCIAL_STATEMENT",
    toType: "INCOME_STATEMENT",
    ...base,
  });

  const hash2 = computeOverrideFingerprint({
    fromType: "PERSONAL_TAX_RETURN",
    toType: "BUSINESS_TAX_RETURN",
    ...base,
  });

  assert.notStrictEqual(
    hash1,
    hash2,
    "Different (fromType, toType) pairs must produce different fingerprints",
  );

  console.log(
    `[overrideIntegrityGuard] Guard 4: distinct fingerprints for distinct pairs ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 5: generateGoldenTest returns ONLY test.skip() stubs — NEVER test()
//          CI-BLOCKING: if this fires, the generator has a defect
// ---------------------------------------------------------------------------

test("Guard 5 [CI-BLOCKING]: generateGoldenTest returns ONLY test.skip() stubs — never test()", () => {
  const clusters: ClusterInput[] = [
    {
      fromType: "FINANCIAL_STATEMENT",
      toType: "INCOME_STATEMENT",
      overrideCount: 7,
      avgConfidence: 0.75,
      dominantClassifierSource: "Rules",
      classificationVersionRange: "v2.0 → v2.1",
      segmentationPresenceRatio: 0.14,
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-02-01T00:00:00Z",
    },
    {
      fromType: "PERSONAL_TAX_RETURN",
      toType: "BUSINESS_TAX_RETURN",
      overrideCount: 5,
      avgConfidence: 0.88,
      dominantClassifierSource: "Gemini",
      classificationVersionRange: "v2.1 → v2.1",
      segmentationPresenceRatio: 0.0,
      firstSeenAt: "2026-01-15T00:00:00Z",
      lastSeenAt: "2026-02-10T00:00:00Z",
    },
  ];

  const output = generateGoldenTest(clusters, {
    generatedAt: "2026-02-19T12:00:00Z",
    filenameVersion: "v1",
  });

  assert.ok(output.length > 0, "Output must not be empty for eligible clusters");

  // NON-NEGOTIABLE: no bare test( calls — only test.skip(
  // We search for test( not preceded by .skip — this is the CI-blocking invariant
  const bareTestCalls = output.match(/(?<!\.skip)\btest\s*\(/g) ?? [];
  assert.strictEqual(
    bareTestCalls.length,
    0,
    `[CI-BLOCKING] Generated output contains bare test() calls: ${JSON.stringify(bareTestCalls)}. All stubs must be test.skip().`,
  );

  // Must contain test.skip(
  assert.ok(
    output.includes("test.skip("),
    "Generated output must contain test.skip() stubs",
  );

  console.log(
    `[overrideIntegrityGuard] Guard 5 [CI-BLOCKING]: all stubs are test.skip() ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 6: generateGoldenTest deduplicates identical (from, to) clusters
// ---------------------------------------------------------------------------

test("Guard 6: generateGoldenTest deduplicates identical (from, to) clusters, keeps highest count", () => {
  const clusters: ClusterInput[] = [
    {
      fromType: "FINANCIAL_STATEMENT",
      toType: "INCOME_STATEMENT",
      overrideCount: 5,
      avgConfidence: 0.70,
      dominantClassifierSource: "Rules",
      classificationVersionRange: "v2.0 → v2.0",
      segmentationPresenceRatio: 0.0,
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-15T00:00:00Z",
    },
    {
      // Same (from, to) pair — higher count. This one should win.
      fromType: "FINANCIAL_STATEMENT",
      toType: "INCOME_STATEMENT",
      overrideCount: 12,
      avgConfidence: 0.80,
      dominantClassifierSource: "Gemini",
      classificationVersionRange: "v2.1 → v2.1",
      segmentationPresenceRatio: 0.25,
      firstSeenAt: "2026-01-10T00:00:00Z",
      lastSeenAt: "2026-02-10T00:00:00Z",
    },
  ];

  const output = generateGoldenTest(clusters, {
    generatedAt: "2026-02-19T12:00:00Z",
    filenameVersion: "v1",
  });

  // Should produce exactly 1 stub (not 2)
  const skipCount = (output.match(/test\.skip\(/g) ?? []).length;
  assert.strictEqual(
    skipCount,
    1,
    `Expected 1 stub after deduplication, got ${skipCount}`,
  );

  // The stub should reference the winner's count (12) not the loser's (5)
  assert.ok(
    output.includes("12"),
    "Deduplicated output must reflect highest override count (12)",
  );

  console.log(
    `[overrideIntegrityGuard] Guard 6: deduplication correct (1 stub, count=12) ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 7: generateGoldenTest returns empty string when no clusters meet minOverrideCount
// ---------------------------------------------------------------------------

test("Guard 7: generateGoldenTest returns empty string when no clusters meet minOverrideCount", () => {
  const clusters: ClusterInput[] = [
    {
      fromType: "FINANCIAL_STATEMENT",
      toType: "INCOME_STATEMENT",
      overrideCount: 2,   // below default min of 3
      avgConfidence: 0.9,
      dominantClassifierSource: "Rules",
      classificationVersionRange: "v2.0 → v2.0",
      segmentationPresenceRatio: 0.0,
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-10T00:00:00Z",
    },
  ];

  const output = generateGoldenTest(clusters, {
    generatedAt: "2026-02-19T12:00:00Z",
    filenameVersion: "v1",
    minOverrideCount: 3,
  });

  assert.strictEqual(
    output,
    "",
    "generateGoldenTest must return empty string when no clusters meet minOverrideCount",
  );

  // Also test with explicitly empty array
  const emptyOutput = generateGoldenTest([], {
    generatedAt: "2026-02-19T12:00:00Z",
    filenameVersion: "v1",
  });
  assert.strictEqual(emptyOutput, "", "Empty cluster list must return empty string");

  console.log(`[overrideIntegrityGuard] Guard 7: empty output for below-threshold clusters ✓`);
});

// ---------------------------------------------------------------------------
// Guard 8: computeOverrideFingerprint output starts with SHA-256 of "override_v1|..."
//          Verified by checking the canonical prefix is stable (version stability)
// ---------------------------------------------------------------------------

test("Guard 8: computeOverrideFingerprint canonical prefix — 'override_v1' in pre-image is version-stable", () => {
  const { createHash } = require("crypto");

  const input = {
    fromType: "FINANCIAL_STATEMENT",
    toType: "INCOME_STATEMENT",
    confidenceBucket: bucketConfidence(0.75) as "low" | "medium" | "high",
    classifierSource: "Rules",
    classificationVersion: "v2.1",
  };

  const canonical = [
    "override_v1",
    input.fromType,
    input.toType,
    input.confidenceBucket,
    input.classifierSource,
    input.classificationVersion,
  ].join("|");

  const expectedHash = createHash("sha256").update(canonical, "utf8").digest("hex");
  const actualHash = computeOverrideFingerprint(input);

  assert.strictEqual(
    actualHash,
    expectedHash,
    "computeOverrideFingerprint must use canonical string 'override_v1|...' as SHA-256 pre-image",
  );

  // Confirm version prefix stability: the pre-image must start with "override_v1"
  assert.ok(
    canonical.startsWith("override_v1"),
    "Canonical pre-image must start with 'override_v1' for version stability",
  );

  console.log(
    `[overrideIntegrityGuard] Guard 8: override_v1 prefix stable, hash=${actualHash.slice(0, 16)}... ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 9: generateGoldenTest header includes GENERATED_AT and fingerprint reference
// ---------------------------------------------------------------------------

test("Guard 9: generateGoldenTest header includes GENERATED_AT and fingerprint reference", () => {
  const generatedAt = "2026-02-19T12:00:00Z";
  const clusters: ClusterInput[] = [
    {
      fromType: "FINANCIAL_STATEMENT",
      toType: "INCOME_STATEMENT",
      overrideCount: 8,
      avgConfidence: 0.77,
      dominantClassifierSource: "Rules",
      classificationVersionRange: "v2.0 → v2.1",
      segmentationPresenceRatio: 0.10,
      firstSeenAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-02-01T00:00:00Z",
    },
  ];

  const output = generateGoldenTest(clusters, {
    generatedAt,
    filenameVersion: "v1",
  });

  assert.ok(
    output.includes(generatedAt),
    `Generated output must include GENERATED_AT="${generatedAt}" in header`,
  );

  assert.ok(
    output.includes("Fingerprint:"),
    "Generated output must include a fingerprint reference per stub",
  );

  assert.ok(
    output.includes("GENERATED_AT"),
    "Generated output must include GENERATED_AT label in header comment",
  );

  console.log(`[overrideIntegrityGuard] Guard 9: header includes GENERATED_AT + fingerprint ✓`);
});
