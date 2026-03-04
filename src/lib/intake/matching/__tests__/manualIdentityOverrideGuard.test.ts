/**
 * Manual Identity Override CI Guards — Phase U.3
 *
 * Ensures identity enforcement respects manual authority:
 * banker-confirmed docs bypass identity inference mismatch routing.
 *
 * MANUAL-ID-G1: runMatch.ts contains manual authority bypass for identity enforcement
 * MANUAL-ID-G2: identity enforcement logic ("identity_enforcement") still exists
 * MANUAL-ID-G3: non-manual path still routes to review on identity mismatch
 * MANUAL-ID-G4: manual path allows auto-attach despite identity mismatch
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const RUN_MATCH_PATH = path.join(
  process.cwd(),
  "src/lib/intake/matching/runMatch.ts",
);

function readSource(): string {
  return fs.readFileSync(RUN_MATCH_PATH, "utf8");
}

// ─── MANUAL-ID-G1: Manual authority bypass present in identity enforcement ────

test("MANUAL-ID-G1: runMatch.ts contains manual authority bypass for identity enforcement", () => {
  const src = readSource();

  assert.ok(
    src.includes('matchSource === "manual"'),
    'runMatch.ts must check matchSource === "manual" in identity enforcement block',
  );

  assert.ok(
    src.includes("isManualAuthority"),
    "runMatch.ts must define isManualAuthority variable for identity enforcement bypass",
  );

  assert.ok(
    src.includes("!isManualAuthority"),
    "runMatch.ts must gate identity enforcement on !isManualAuthority",
  );
});

// ─── MANUAL-ID-G2: Identity enforcement still exists (not deleted) ────────────

test("MANUAL-ID-G2: identity enforcement logic still exists in runMatch.ts", () => {
  const src = readSource();

  assert.ok(
    src.includes("identity_enforcement"),
    'runMatch.ts must still contain "identity_enforcement" reason string',
  );

  assert.ok(
    src.includes("match.identity_mismatch"),
    'runMatch.ts must still emit "match.identity_mismatch" event',
  );

  assert.ok(
    src.includes("ENTITY_PROTECTION_THRESHOLD"),
    "runMatch.ts must still reference ENTITY_PROTECTION_THRESHOLD for enforcement activation",
  );

  assert.ok(
    src.includes("enforcementSlot"),
    "runMatch.ts must still compute enforcementSlot for identity mismatch detection",
  );
});

// ─── MANUAL-ID-G3: Non-manual identity mismatch → routed_to_review ────────────

test("MANUAL-ID-G3: non-manual path still routes to review on identity mismatch", () => {
  const src = readSource();

  // The enforcement block must set decision = "routed_to_review" inside !isManualAuthority
  // Verify structural ordering: isManualAuthority check → then routing
  const manualAuthorityIdx = src.indexOf("if (!isManualAuthority)");
  assert.ok(manualAuthorityIdx > -1, "!isManualAuthority guard must exist");

  const afterGuard = src.slice(manualAuthorityIdx);
  const routeIdx = afterGuard.indexOf('"routed_to_review"');
  assert.ok(
    routeIdx > -1 && routeIdx < 200,
    'routed_to_review must appear shortly after !isManualAuthority guard (non-manual still blocked)',
  );

  const reasonIdx = afterGuard.indexOf('"identity_enforcement"');
  assert.ok(
    reasonIdx > -1 && reasonIdx < 200,
    'identity_enforcement reason must appear inside !isManualAuthority block',
  );
});

// ─── MANUAL-ID-G4: Manual authority allows auto-attach (bypass enforcement) ───

test("MANUAL-ID-G4: manual authority bypasses identity enforcement (structural proof)", () => {
  const src = readSource();

  // The enforcement routing is INSIDE if (!isManualAuthority).
  // When isManualAuthority = true, the block is skipped → result.decision stays "auto_attached".
  // Verify: "routed_to_review" + "identity_enforcement" are ONLY inside !isManualAuthority.

  // Find the identity enforcement section
  const enforcementStart = src.indexOf("if (enforcementSlot)");
  assert.ok(enforcementStart > -1, "enforcementSlot check must exist");

  const enforcementBlock = src.slice(enforcementStart, enforcementStart + 800);

  // Verify the manual authority check wraps the routing decision
  const manualIdx = enforcementBlock.indexOf("isManualAuthority");
  const routeIdx = enforcementBlock.indexOf('"routed_to_review"');
  assert.ok(
    manualIdx > -1 && routeIdx > -1 && manualIdx < routeIdx,
    "isManualAuthority check must appear BEFORE routed_to_review (manual bypasses enforcement)",
  );

  // Verify that "manual_confirmed" is also recognized as manual authority
  assert.ok(
    src.includes('"manual_confirmed"'),
    'runMatch.ts must also recognize "manual_confirmed" as manual authority',
  );
});
