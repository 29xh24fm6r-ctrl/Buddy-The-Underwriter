/**
 * Intake Spine Tripwire — CI-Blocking
 *
 * Buddy doctrine: there is exactly ONE canonical classification path.
 * Orchestrated/backfill intake must never drift away from the spine.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readOrchestrateIntakeSource(): string {
  const p = path.join(process.cwd(), "src/lib/intake/orchestrateIntake.ts");
  return fs.readFileSync(p, "utf8");
}

test("[tripwire] orchestrateIntake must route classification through classifyDocumentSpine", () => {
  const src = readOrchestrateIntakeSource();

  // Required: the spine is used.
  assert.ok(
    src.includes("classifyDocumentSpine"),
    "orchestrateIntake.ts must reference classifyDocumentSpine (single source of truth)",
  );

  // Forbidden: legacy divergent path.
  const forbidden = [
    "@/lib/intelligence/classifyDocument",
    "src/lib/intelligence/classifyDocument",
    "inferDocumentMetadata",
    "mapClassifierDocTypeToCanonicalBucket",
  ];

  for (const token of forbidden) {
    assert.ok(
      !src.includes(token),
      `orchestrateIntake.ts must not include legacy divergence token: ${token}`,
    );
  }
});
