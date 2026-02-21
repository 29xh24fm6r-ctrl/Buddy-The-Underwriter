/**
 * Slot Engine Effective Truth Guard — Regression Protection
 *
 * Ensures the slot matching/validation pipeline never directly references
 * raw gatekeeper or AI classification fields. These must be resolved
 * through the identity layer (DocumentIdentity.effectiveDocType).
 *
 * This is a belt-and-suspenders guard — the architecture is already clean,
 * but this prevents future regression.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = path.join(process.cwd(), "src", "lib");

/** Directories whose files must NOT directly reference raw classification fields. */
const SCAN_TARGETS = [
  path.join(ROOT, "intake", "matching"),
  path.join(ROOT, "intake", "slots"),
];

/** Banned field references — raw AI/gatekeeper columns. */
const BANNED_PATTERN =
  /\bgatekeeper_doc_type\b|\bgatekeeper_tax_year\b|\bai_doc_type\b|\bai_tax_year\b/g;

/**
 * Allowlisted files that legitimately reference raw fields
 * (identity resolution layer, classification modules, ingestion orchestrators).
 */
function isAllowlisted(filePath: string): boolean {
  const base = path.basename(filePath);
  if (base === "identity.ts") return true;
  if (base.startsWith("classify")) return true;
  if (base === "processArtifact.ts") return true;
  if (base === "processConfirmedIntake.ts") return true;
  if (base === "resolveEffectiveClassification.ts") return true;
  if (filePath.includes("gatekeeper")) return true;
  // Test files for this guard itself
  if (base === "slotEngineEffectiveTruthGuard.test.ts") return true;
  return false;
}

// ---------------------------------------------------------------------------
// File scanner
// ---------------------------------------------------------------------------

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(p));
    } else if (p.endsWith(".ts") || p.endsWith(".tsx")) {
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

describe("slotEngineEffectiveTruthGuard", () => {
  it("slot matching and validation files must not reference raw gatekeeper/AI fields", () => {
    const files = SCAN_TARGETS.flatMap(listTsFiles);

    const offenders: Array<{ file: string; matches: string[] }> = [];

    for (const filePath of files) {
      if (isAllowlisted(filePath)) continue;

      const content = fs.readFileSync(filePath, "utf8");
      const matches = content.match(BANNED_PATTERN);
      if (matches && matches.length > 0) {
        offenders.push({
          file: path.relative(process.cwd(), filePath),
          matches: [...new Set(matches)],
        });
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `Raw gatekeeper/AI field references found in slot engine files:\n${
        offenders
          .map((o) => `  ${o.file}: ${o.matches.join(", ")}`)
          .join("\n")
      }`,
    );
  });
});
