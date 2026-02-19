/**
 * Spine Tripwire Tests — CI-Blocking Structural Invariants
 *
 * These tests read source files as strings and verify that classification
 * invariants hold at the source level. They catch regressions that could
 * slip through runtime-only tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const BASE = path.join(process.cwd(), "src/lib/classification");
const ARTIFACTS = path.join(process.cwd(), "src/lib/artifacts");

function readSrc(file: string): string {
  return fs.readFileSync(path.join(BASE, file), "utf8");
}

// ─── 1. No T12 in Tier 1 anchors ────────────────────────────────────────────

test("Tripwire: No T12 in Tier 1 anchor docTypes", () => {
  const src = readSrc("tier1Anchors.ts");
  // Scan from first anchor definition to "// Public API"
  const startIdx = src.indexOf("const FORM_ANCHORS");
  const endIdx = src.indexOf("// Public API");
  assert.ok(startIdx > -1, "Should find FORM_ANCHORS in tier1Anchors.ts");
  assert.ok(endIdx > startIdx, "Should find // Public API after anchors");

  const anchorsSection = src.slice(startIdx, endIdx);

  const docTypeMatches = [...anchorsSection.matchAll(/docType:\s*"([^"]+)"/g)];
  assert.ok(docTypeMatches.length > 0, "Should find docType entries in anchors");

  for (const m of docTypeMatches) {
    assert.notEqual(
      m[1],
      "T12",
      `Tier 1 anchor maps docType to T12 — invariant violation`,
    );
  }
});

// ─── 2. No T12 in Tier 2 outputs ────────────────────────────────────────────

test("Tripwire: No T12 in Tier 2 structural pattern docTypes", () => {
  const src = readSrc("tier2Structural.ts");
  const patternsSection = src.slice(
    src.indexOf("const STRUCTURAL_PATTERNS"),
    src.indexOf("// Public API") !== -1
      ? src.indexOf("// Public API")
      : src.indexOf("export function"),
  );

  const docTypeMatches = [...patternsSection.matchAll(/docType:\s*"([^"]+)"/g)];
  assert.ok(docTypeMatches.length > 0, "Should find docType entries in patterns");

  for (const m of docTypeMatches) {
    assert.notEqual(
      m[1],
      "T12",
      `Tier 2 pattern maps docType to T12 — invariant violation`,
    );
  }
});

// ─── 3. Tier 2 cannot override Tier 1 ───────────────────────────────────────

test("Tripwire: Confidence gate checks Tier 1 before Tier 2", () => {
  const src = readSrc("confidenceGate.ts");

  const tier1Index = src.indexOf("tier1.matched");
  const tier2Index = src.indexOf("tier2.matched");

  assert.ok(tier1Index > -1, "Should reference tier1.matched");
  assert.ok(tier2Index > -1, "Should reference tier2.matched");
  assert.ok(
    tier1Index < tier2Index,
    "Tier 1 check must come before Tier 2 check in confidence gate",
  );
});

// ─── 4. LLM skipped when Tier 1 matches ─────────────────────────────────────

test("Tripwire: Spine returns immediately after Tier 1 match (no LLM)", () => {
  const src = readSrc("classifyDocumentSpine.ts");

  // Find the tier1.matched check that returns early
  const tier1ReturnPattern = /if\s*\(tier1\.matched\)\s*\{[\s\S]*?return\s+finalize/;
  assert.ok(
    tier1ReturnPattern.test(src),
    "Spine must return immediately after tier1.matched — LLM skipped",
  );
});

// ─── 5. Classification always produces evidence ──────────────────────────────

test("Tripwire: SpineClassificationResult includes evidence array", () => {
  const src = readSrc("types.ts");
  assert.ok(
    src.includes("evidence: EvidenceItem[]"),
    "SpineClassificationResult must include evidence: EvidenceItem[]",
  );
});

// ─── 6. CLASSIFICATION_SCHEMA_VERSION defined and starts with 'v' ────────────

test("Tripwire: CLASSIFICATION_SCHEMA_VERSION defined and starts with 'v'", () => {
  const src = readSrc("types.ts");

  const match = src.match(/CLASSIFICATION_SCHEMA_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(match, "CLASSIFICATION_SCHEMA_VERSION must be defined");
  assert.ok(
    match![1].startsWith("v"),
    `CLASSIFICATION_SCHEMA_VERSION must start with 'v', got: ${match![1]}`,
  );
});

// ─── 7. processArtifact uses spine (not classifyDocument as call target) ─────

test("Tripwire: processArtifact imports classifyDocumentSpine", () => {
  const src = fs.readFileSync(
    path.join(ARTIFACTS, "processArtifact.ts"),
    "utf8",
  );

  assert.ok(
    src.includes("classifyDocumentSpine"),
    "processArtifact must import classifyDocumentSpine",
  );

  // Ensure the actual call is to classifyDocumentSpine, not classifyDocument
  const callPattern = /await\s+classifyDocumentSpine\(/;
  assert.ok(
    callPattern.test(src),
    "processArtifact must call classifyDocumentSpine(), not classifyDocument()",
  );
});

// ─── 8. classification_version stamped ───────────────────────────────────────

test("Tripwire: processArtifact stamps classification_version", () => {
  const src = fs.readFileSync(
    path.join(ARTIFACTS, "processArtifact.ts"),
    "utf8",
  );

  assert.ok(
    src.includes("classification_version:"),
    "processArtifact must stamp classification_version on deal_documents",
  );
});

// ─── 9. classification_tier stamped ──────────────────────────────────────────

test("Tripwire: processArtifact stamps classification_tier", () => {
  const src = fs.readFileSync(
    path.join(ARTIFACTS, "processArtifact.ts"),
    "utf8",
  );

  assert.ok(
    src.includes("classification_tier:"),
    "processArtifact must stamp classification_tier on deal_documents",
  );
});

// ─── 10. Low confidence < 0.65 never accepted by gate ────────────────────────

test("Tripwire: Confidence gate rejects below threshold", () => {
  const src = readSrc("confidenceGate.ts");

  // The threshold must be defined and ≥ 0.65
  const thresholdMatch = src.match(/TIER2_ACCEPT_THRESHOLD\s*=\s*([\d.]+)/);
  assert.ok(thresholdMatch, "TIER2_ACCEPT_THRESHOLD must be defined");
  const threshold = parseFloat(thresholdMatch![1]);
  assert.ok(
    threshold >= 0.65,
    `TIER2_ACCEPT_THRESHOLD must be ≥ 0.65, got ${threshold}`,
  );
});

// ─── 11. All Tier 1 confidences ≥ 0.90 ──────────────────────────────────────

test("Tripwire: All Tier 1 anchor confidences ≥ 0.90", () => {
  const src = readSrc("tier1Anchors.ts");
  const startIdx = src.indexOf("const FORM_ANCHORS");
  const endIdx = src.indexOf("// Public API");
  const anchorsSection = src.slice(startIdx, endIdx);

  const confidenceMatches = [
    ...anchorsSection.matchAll(/confidence:\s*([\d.]+)/g),
  ];
  assert.ok(
    confidenceMatches.length > 0,
    "Should find confidence entries in anchors",
  );

  for (const m of confidenceMatches) {
    const conf = parseFloat(m[1]);
    assert.ok(
      conf >= 0.9,
      `Tier 1 anchor confidence ${conf} is below 0.90 — invariant violation`,
    );
  }
});

// ─── 12. All Tier 2 confidences < 0.90 ──────────────────────────────────────

test("Tripwire: All Tier 2 structural confidences < 0.90", () => {
  const src = readSrc("tier2Structural.ts");
  const patternsSection = src.slice(
    src.indexOf("const STRUCTURAL_PATTERNS"),
    src.indexOf("// Public API") !== -1
      ? src.indexOf("// Public API")
      : src.indexOf("export function"),
  );

  const confidenceMatches = [
    ...patternsSection.matchAll(/confidence:\s*([\d.]+)/g),
  ];
  assert.ok(
    confidenceMatches.length > 0,
    "Should find confidence entries in patterns",
  );

  for (const m of confidenceMatches) {
    const conf = parseFloat(m[1]);
    assert.ok(
      conf < 0.9,
      `Tier 2 pattern confidence ${conf} is ≥ 0.90 — invariant violation`,
    );
  }
});
