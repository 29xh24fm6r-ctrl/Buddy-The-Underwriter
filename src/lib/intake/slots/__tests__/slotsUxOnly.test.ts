import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Slots UX-Only Invariant Tests
//
// These tests lock the invariant: slots are PURELY UX grouping (drop targets,
// upload buckets). They NEVER influence routing, extraction, spread selection,
// readiness, or lifecycle. Gatekeeper + classifier determine truth.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// 1. validateSlotAttachment flags mismatches as status: "rejected" (UI-only)
// ---------------------------------------------------------------------------
//
// "Slots are UX-only" means slot state never feeds BACK into routing,
// extraction, spread selection, readiness, or lifecycle (see tests below,
// and matchEngine.ts / recomputeDealDocumentState.ts, neither of which read
// deal_document_slots.status). It does NOT mean a type mismatch must be
// invisible: CoreDocumentsPanel.tsx has dedicated rendering for
// status === "rejected" (an informational "Mismatch" banner) that must
// actually be reachable — a mismatched doc still gets attached and can
// still be banker-confirmed, but must not silently look identical to a
// clean attachment in the UI.

test("validateSlotAttachment sets status to rejected on type mismatch", () => {
  const src = readFile("src/lib/intake/slots/validateSlotAttachment.ts");
  assert.ok(
    src.includes('status: "rejected"') || src.includes("status: 'rejected'"),
    "validateSlotAttachment must set status to 'rejected' on type mismatch so the UI warning fires",
  );
});

// ---------------------------------------------------------------------------
// 2. validateSlotAttachment returns validated: false on type mismatch
// ---------------------------------------------------------------------------

test("validateSlotAttachment returns validated: false on type mismatch", () => {
  const src = readFile("src/lib/intake/slots/validateSlotAttachment.ts");
  assert.ok(
    src.includes("validated: false"),
    "validateSlotAttachment must return validated: false on type mismatch",
  );
});

// ---------------------------------------------------------------------------
// 3. processArtifact does not use slotDocType for effectiveDocType
// ---------------------------------------------------------------------------

test("processArtifact does not assign effectiveDocType from slotDocType", () => {
  const src = readFile("src/lib/artifacts/processArtifact.ts");
  assert.ok(
    !src.includes("effectiveDocType = slotDocType"),
    "effectiveDocType must never be assigned from slotDocType",
  );
  // Also check for other possible assignment patterns
  assert.ok(
    !(/effectiveDocType\s*=\s*slotDoc/).test(src),
    "effectiveDocType must never be derived from slot doc type in any form",
  );
});

// ---------------------------------------------------------------------------
// 4. processArtifact does not use slotDocType for spread routing
// ---------------------------------------------------------------------------

test("processArtifact does not use slotDocType for spread routing", () => {
  const src = readFile("src/lib/artifacts/processArtifact.ts");
  const spreadSection = src.slice(
    src.indexOf("6.5c. Enqueue financial spread"),
  );
  assert.ok(
    spreadSection.length > 0,
    "Spread section must exist in processArtifact",
  );
  assert.ok(
    !spreadSection.includes("slotDocTypeForSpreads"),
    "Spread section must NOT reference slotDocTypeForSpreads",
  );
  assert.ok(
    !spreadSection.includes("docType = slotDocType"),
    "Spread section must NOT assign docType from slotDocType",
  );
});

// ---------------------------------------------------------------------------
// 5. isSlotsUxOnly function does not exist in flags
// ---------------------------------------------------------------------------

test("isSlotsUxOnly flag has been removed", () => {
  const src = readFile("src/lib/flags/openaiGatekeeper.ts");
  assert.ok(
    !src.includes("function isSlotsUxOnly"),
    "isSlotsUxOnly function must not exist — slots are always UX-only",
  );
  // Env var may appear in removal comments but must not be read via process.env
  assert.ok(
    !src.includes("process.env.SLOTS_UX_ONLY"),
    "SLOTS_UX_ONLY env var must not be read",
  );
});

// ---------------------------------------------------------------------------
// 6. isGatekeeperShadowCompareEnabled does not exist in flags
// ---------------------------------------------------------------------------

test("isGatekeeperShadowCompareEnabled flag has been removed", () => {
  const src = readFile("src/lib/flags/openaiGatekeeper.ts");
  assert.ok(
    !src.includes("function isGatekeeperShadowCompareEnabled"),
    "isGatekeeperShadowCompareEnabled function must not exist — shadow compare is unconditional",
  );
  // Env var may appear in removal comments but must not be read via process.env
  assert.ok(
    !src.includes("process.env.GATEKEEPER_SHADOW_COMPARE"),
    "GATEKEEPER_SHADOW_COMPARE env var must not be read",
  );
});

// ---------------------------------------------------------------------------
// 7. Lifecycle code does not reference deal_document_slots
// ---------------------------------------------------------------------------

test("lifecycle engine does not reference deal_document_slots", () => {
  const lifecycleDir = path.join(ROOT, "src/buddy/lifecycle");
  const files = fs.readdirSync(lifecycleDir).filter((f) => f.endsWith(".ts"));

  for (const file of files) {
    const src = fs.readFileSync(path.join(lifecycleDir, file), "utf-8");
    assert.ok(
      !src.includes("deal_document_slots"),
      `Lifecycle file ${file} must NOT reference deal_document_slots`,
    );
    // Also check for slot_id references (lifecycle should not read slot state)
    assert.ok(
      !src.includes("slot_id"),
      `Lifecycle file ${file} must NOT reference slot_id`,
    );
  }
});

// ---------------------------------------------------------------------------
// 8. processArtifact never assigns effectiveDocType = slotDocType (regex)
// ---------------------------------------------------------------------------

test("no code path in processArtifact assigns effectiveDocType from slot", () => {
  const src = readFile("src/lib/artifacts/processArtifact.ts");

  // Check for any assignment pattern: effectiveDocType = slot*
  const slotAssignRegex = /effectiveDocType\s*=\s*slot/g;
  const matches = src.match(slotAssignRegex);
  assert.equal(
    matches,
    null,
    `Found slot-based effectiveDocType assignment: ${matches?.join(", ")}`,
  );

  // Also verify gatekeeper is primary (mapGatekeeperDocTypeToEffectiveDocType used)
  assert.ok(
    src.includes("mapGatekeeperDocTypeToEffectiveDocType"),
    "Gatekeeper mapping must be used for routing",
  );
});
