/**
 * Golden Test Generator — Institutional Self-Hardening
 *
 * Pure function: takes override cluster data, returns TypeScript source
 * containing test.skip() stubs for human review. Humans promote stubs to
 * test() after verification — CI regression protection grows incrementally.
 *
 * NON-NEGOTIABLE:
 *   - All stubs are test.skip() — NEVER test()
 *   - No DB, no IO, no side effects
 *   - Caller provides generatedAt (never Date.now())
 *   - Deterministic output — same input → same output
 *
 * Generated file convention:
 *   src/lib/intake/matching/__tests__/override_generated/override_golden_{version}.test.ts
 *
 * Supersedes: scripts/generateGoldenFromOverrides.ts (dev script, stdout only)
 */

import { computeOverrideFingerprint, bucketConfidence } from "./computeOverrideFingerprint";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClusterInput = {
  fromType: string;
  toType: string;
  overrideCount: number;
  avgConfidence: number | null;
  dominantClassifierSource: string | null;
  classificationVersionRange: string | null;
  segmentationPresenceRatio: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type GoldenTestOptions = {
  /** Minimum override count to include in output. Default: 3. */
  minOverrideCount?: number;
  /** Supplied by caller — NEVER use Date.now() or new Date() here */
  generatedAt: string;
  /** Version suffix for output filename convention. e.g. "v1" */
  filenameVersion: string;
};

// ---------------------------------------------------------------------------
// generateGoldenTest — pure function
// ---------------------------------------------------------------------------

/**
 * Returns TypeScript source string with test.skip() stubs derived from clusters.
 *
 * Returns empty string when:
 *   - clusters is empty
 *   - no clusters pass minOverrideCount after deduplication
 *
 * Deduplication: identical (fromType, toType) pairs are collapsed, keeping
 * the entry with the highest overrideCount.
 */
export function generateGoldenTest(
  clusters: ClusterInput[],
  options: GoldenTestOptions,
): string {
  const minCount = options.minOverrideCount ?? 3;

  // Step 1: Deduplicate — keep highest overrideCount per (fromType, toType) pair
  const deduped = new Map<string, ClusterInput>();
  for (const c of clusters) {
    const key = `${c.fromType}|||${c.toType}`;
    const existing = deduped.get(key);
    if (!existing || c.overrideCount > existing.overrideCount) {
      deduped.set(key, c);
    }
  }

  // Step 2: Filter by minOverrideCount
  const eligible = Array.from(deduped.values()).filter(
    (c) => c.overrideCount >= minCount,
  );

  if (eligible.length === 0) return "";

  // Step 3: Sort deterministically by overrideCount DESC, then fromType ASC
  eligible.sort((a, b) => {
    if (b.overrideCount !== a.overrideCount) return b.overrideCount - a.overrideCount;
    return a.fromType.localeCompare(b.fromType);
  });

  // Step 4: Build stubs
  const stubs = eligible.map((c) => {
    const fingerprint = computeOverrideFingerprint({
      fromType: c.fromType,
      toType: c.toType,
      confidenceBucket: bucketConfidence(c.avgConfidence),
      classifierSource: c.dominantClassifierSource,
      classificationVersion: c.classificationVersionRange ?? null,
    });

    const meta = [
      `   * Cluster: ${c.fromType} → ${c.toType}`,
      `   * Override count: ${c.overrideCount}`,
      `   * Avg confidence at time: ${c.avgConfidence !== null ? c.avgConfidence.toFixed(3) : "n/a"}`,
      `   * Dominant classifier: ${c.dominantClassifierSource ?? "unknown"}`,
      `   * Classification version range: ${c.classificationVersionRange ?? "unknown"}`,
      `   * Segmentation presence ratio: ${c.segmentationPresenceRatio !== null ? (c.segmentationPresenceRatio * 100).toFixed(1) + "%" : "n/a"}`,
      `   * First seen: ${c.firstSeenAt}`,
      `   * Last seen: ${c.lastSeenAt}`,
      `   * Fingerprint: ${fingerprint}`,
    ].join("\n");

    return `  /**\n${meta}\n   */\n  test.skip("${c.fromType} misclassified as ${c.toType} — cluster override correction", () => {\n    // TODO: Provide a representative document fixture for this cluster\n    // const result = classifyDocument(fixture);\n    // assert.strictEqual(result.type, "${c.toType}");\n    throw new Error("Stub not yet activated — provide fixture then remove .skip suffix to enable");\n  });`;
  });

  // Step 5: Assemble file
  const header = [
    `/**`,
    ` * Override Intelligence — Generated Golden Test Stubs`,
    ` *`,
    ` * GENERATED_AT: ${options.generatedAt}`,
    ` * FILENAME_VERSION: ${options.filenameVersion}`,
    ` * CLUSTER_COUNT: ${eligible.length}`,
    ` * MIN_OVERRIDE_COUNT: ${minCount}`,
    ` *`,
    ` * ALL STUBS ARE test.skip — remove the ".skip" suffix after fixture review to activate.`,
    ` * Activating a stub expands CI regression protection for this cluster.`,
    ` *`,
    ` * DO NOT auto-regenerate over a file that has activated stubs.`,
    ` * Use a new filenameVersion (e.g. v2) to avoid overwriting human-promoted tests.`,
    ` */`,
    ``,
    `import test from "node:test";`,
    `// import assert from "node:assert/strict";`,
    `// import { classifyDocument } from "../../classifyDocument";`,
    ``,
  ].join("\n");

  return header + stubs.join("\n\n") + "\n";
}
