/**
 * CI Source Guards — Routing Class Constraint Drift Prevention
 *
 * These are SOURCE GUARDS — not integration tests.
 * They read source files as strings and import pure modules to assert
 * structural invariants that must hold to prevent schema drift.
 *
 * Background: The DocAI→ADE pivot (2026-02-24) replaced DOC_AI_ATOMIC with
 * GEMINI_STRUCTURED in the TypeScript routing map, but no migration updated
 * the deal_documents_routing_class_check constraint. This caused 100% of
 * tax returns, income statements, balance sheets, and PFS documents to fail
 * stamping with a CHECK constraint violation.
 *
 * Enforced invariants:
 *  1. ROUTING_CLASS_MAP values ⊆ allowed routing classes
 *  2. Allowed routing classes set matches canonical list
 *  3. processArtifact.ts segmentation stamp includes classification_confidence
 *  4. processArtifact.ts segmentation artifact update includes doc_type
 *  5. processArtifact.ts uses buildCanonicalStampPayload (unified stamp)
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __esmDirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__esmDirname, "../../../..");

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

// ── Canonical allowed set — must match CHECK constraint in migration ──
const ALLOWED_ROUTING_CLASSES = new Set([
  "GEMINI_STRUCTURED",
  "GEMINI_PACKET",
  "GEMINI_STANDARD",
  "DOC_AI_ATOMIC", // legacy compat only
]);

const routingSrc = readSource("src/lib/documents/docTypeRouting.ts");
const processArtifactSrc = readSource("src/lib/artifacts/processArtifact.ts");

describe("Routing Class Constraint Guards", () => {
  // ── Guard 1: ROUTING_CLASS_MAP values must be in allowed set ──────────

  test("[guard-1] ROUTING_CLASS_MAP values must be in allowed routing classes", () => {
    // Extract all string values from the ROUTING_CLASS_MAP object literal
    const mapSection = routingSrc.match(
      /ROUTING_CLASS_MAP[^{]*\{([\s\S]*?)\};/,
    );
    assert.ok(mapSection, "Could not find ROUTING_CLASS_MAP in docTypeRouting.ts");

    const values = [...mapSection[1].matchAll(/"([A-Z_]+)"/g)].map(
      (m) => m[1],
    );
    assert.ok(
      values.length > 0,
      "ROUTING_CLASS_MAP must have at least one value",
    );

    for (const val of values) {
      assert.ok(
        ALLOWED_ROUTING_CLASSES.has(val),
        `ROUTING_CLASS_MAP contains "${val}" which is NOT in the allowed set: ${[...ALLOWED_ROUTING_CLASSES].join(", ")}. ` +
          "Update the deal_documents_routing_class_check constraint migration to include this value.",
      );
    }
  });

  // ── Guard 2: RoutingClass type matches allowed set ────────────────────

  test("[guard-2] RoutingClass TypeScript type must match allowed set (minus legacy)", () => {
    const typeMatch = routingSrc.match(
      /export type RoutingClass\s*=\s*([\s\S]*?);/,
    );
    assert.ok(typeMatch, "Could not find RoutingClass type in docTypeRouting.ts");

    const typeValues = [...typeMatch[1].matchAll(/"([A-Z_]+)"/g)].map(
      (m) => m[1],
    );
    assert.ok(
      typeValues.length >= 3,
      "RoutingClass type must have at least 3 values",
    );

    // RoutingClass type should NOT include DOC_AI_ATOMIC (legacy only in constraint)
    for (const val of typeValues) {
      assert.ok(
        ALLOWED_ROUTING_CLASSES.has(val),
        `RoutingClass type contains "${val}" which is NOT in the allowed set`,
      );
      assert.notEqual(
        val,
        "DOC_AI_ATOMIC",
        "RoutingClass TypeScript type must NOT include DOC_AI_ATOMIC (legacy constraint only)",
      );
    }
  });

  // ── Guard 3: Segmentation stamp must include classification_confidence ─

  test("[guard-3] segmentation stamp must include classification_confidence", () => {
    // Find the segmentation block: between "multi-form PDF detected" and the return
    const segBlock = processArtifactSrc.match(
      /multi-form PDF detected[\s\S]*?skipReason.*multi_form_segmented/,
    );
    assert.ok(segBlock, "Could not find segmentation block in processArtifact.ts");

    // classification_confidence must appear either directly or via buildCanonicalStampPayload
    const hasDirectField = segBlock[0].includes("classification_confidence");
    const usesUnifiedHelper = segBlock[0].includes("buildCanonicalStampPayload");
    assert.ok(
      hasDirectField || usesUnifiedHelper,
      "Segmentation stamp must include classification_confidence on deal_documents — " +
        "either directly or via buildCanonicalStampPayload.",
    );
  });

  // ── Guard 4: Segmentation artifact update must include doc_type ────────

  test("[guard-4] segmentation artifact update must include doc_type field", () => {
    const segBlock = processArtifactSrc.match(
      /multi-form PDF detected[\s\S]*?skipReason.*multi_form_segmented/,
    );
    assert.ok(segBlock, "Could not find segmentation block in processArtifact.ts");

    // Must set doc_type on the artifact update (not just doc_type_confidence)
    assert.ok(
      /doc_type:\s/.test(segBlock[0]),
      "Segmentation artifact update must set doc_type on document_artifacts. " +
        "A classified artifact with NULL doc_type violates integrity invariant.",
    );
  });

  // ── Guard 5: processArtifact uses buildCanonicalStampPayload ──────────

  test("[guard-5] processArtifact.ts must use buildCanonicalStampPayload for unified stamp", () => {
    assert.ok(
      processArtifactSrc.includes("buildCanonicalStampPayload"),
      "processArtifact.ts must define and use buildCanonicalStampPayload helper " +
        "to guarantee segmentation and main classification paths stamp identical fields.",
    );

    // Count usages — at minimum: 1 definition + 2 call sites (seg + main)
    const usageCount = (
      processArtifactSrc.match(/buildCanonicalStampPayload/g) || []
    ).length;
    assert.ok(
      usageCount >= 3,
      `buildCanonicalStampPayload must appear at least 3 times (1 definition + 2 calls), found ${usageCount}`,
    );
  });
});
