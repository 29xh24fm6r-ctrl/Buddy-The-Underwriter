/**
 * Manual Override Stamp Guard
 *
 * CI guards verifying that the manual override path in processArtifact.ts
 * now calls resolveDocTyping() before early-returning, ensuring
 * canonical_type/routing_class/checklist_key are always stamped.
 *
 * Uses source-code inspection (not import) to avoid server-only transitive deps.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PROCESS_ARTIFACT_PATH = path.resolve(
  __dirname,
  "../../artifacts/processArtifact.ts",
);

const RESOLVE_DOC_TYPING_PATH = path.resolve(
  __dirname,
  "../../docs/typing/resolveDocTyping.ts",
);

// ── Guard 1: processArtifact manual override block calls resolveDocTyping ────

test("Guard 1: Manual override block calls resolveDocTyping before early return", () => {
  const src = fs.readFileSync(PROCESS_ARTIFACT_PATH, "utf8");

  // Find the manual override block
  const manualBlock = src.indexOf("manualCheck.isManual");
  assert.ok(manualBlock >= 0, "processArtifact must contain manualCheck.isManual block");

  // Find the early return for manual override
  const earlyReturn = src.indexOf('skipReason: "manual_override"', manualBlock);
  assert.ok(earlyReturn >= 0, "processArtifact must have manual_override early return");

  // Between the manual check and the early return, resolveDocTyping must be called
  const manualSection = src.substring(manualBlock, earlyReturn);
  assert.ok(
    manualSection.includes("resolveDocTyping"),
    "Manual override block must call resolveDocTyping() before early return — stamps canonical_type/routing_class/checklist_key",
  );
});

// ── Guard 2: Manual override stamps canonical_type on deal_documents ─────────

test("Guard 2: Manual override stamps canonical_type on deal_documents", () => {
  const src = fs.readFileSync(PROCESS_ARTIFACT_PATH, "utf8");

  const manualBlock = src.indexOf("manualCheck.isManual");
  const earlyReturn = src.indexOf('skipReason: "manual_override"', manualBlock);
  const manualSection = src.substring(manualBlock, earlyReturn);

  assert.ok(
    manualSection.includes("canonical_type:"),
    "Manual override block must stamp canonical_type on deal_documents",
  );
});

// ── Guard 3: Manual override stamps routing_class on deal_documents ──────────

test("Guard 3: Manual override stamps routing_class on deal_documents", () => {
  const src = fs.readFileSync(PROCESS_ARTIFACT_PATH, "utf8");

  const manualBlock = src.indexOf("manualCheck.isManual");
  const earlyReturn = src.indexOf('skipReason: "manual_override"', manualBlock);
  const manualSection = src.substring(manualBlock, earlyReturn);

  assert.ok(
    manualSection.includes("routing_class:"),
    "Manual override block must stamp routing_class on deal_documents",
  );
});

// ── Guard 4: resolveDocTyping is a pure function (no server-only) ────────────

test("Guard 4: resolveDocTyping does not import server-only directly", () => {
  const src = fs.readFileSync(RESOLVE_DOC_TYPING_PATH, "utf8");

  assert.ok(
    !src.includes('"server-only"') && !src.includes("'server-only'"),
    "resolveDocTyping.ts must not directly import server-only — it's used in CI guards",
  );
});

// ── Guard 5: Manual override stamps checklist_key on deal_documents ──────────

test("Guard 5: Manual override stamps checklist_key on deal_documents", () => {
  const src = fs.readFileSync(PROCESS_ARTIFACT_PATH, "utf8");

  const manualBlock = src.indexOf("manualCheck.isManual");
  const earlyReturn = src.indexOf('skipReason: "manual_override"', manualBlock);
  const manualSection = src.substring(manualBlock, earlyReturn);

  assert.ok(
    manualSection.includes("checklist_key:"),
    "Manual override block must stamp checklist_key on deal_documents",
  );
});
