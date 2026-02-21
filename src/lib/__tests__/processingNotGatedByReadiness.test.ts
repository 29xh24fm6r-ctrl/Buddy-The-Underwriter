/**
 * Processing Independence Guard — Regression Tripwire
 *
 * Ensures processing pipelines (spreads, classification, extraction,
 * intake processing) are NEVER gated by readiness checks.
 *
 * Readiness is a derived output, not a processing gate.
 * Only submission may check readiness (assertDealReady).
 *
 * Belt-and-suspenders only. No runtime changes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = path.join(process.cwd(), "src", "lib");

/** Directories whose files must NOT gate processing on readiness. */
const SCAN_TARGETS = [
  path.join(ROOT, "jobs", "processors"),
  path.join(ROOT, "intake", "processing"),
  path.join(ROOT, "financialSpreads"),
];

/** Readiness import patterns — signals a file references readiness. */
const READINESS_IMPORT_PATTERN =
  /getDealReadiness|computeDealReadiness|assertDealReady|from\s+["'].*readiness/;

/** Gating patterns — early returns or throws conditioned on blockers/readiness. */
const GATING_PATTERN =
  /if\s*\(.*(?:blocker|readiness|ready).*\)\s*(?:return|throw)\b/;

/** Files that legitimately reference readiness. */
function isAllowlisted(filePath: string): boolean {
  const base = path.basename(filePath);
  if (base === "assertDealReady.ts") return true;
  if (base === "readiness.ts") return true;
  if (base.endsWith(".test.ts")) return true;
  if (base.endsWith(".test.tsx")) return true;
  // processingNotGatedByReadiness guard itself
  if (base === "processingNotGatedByReadiness.test.ts") return true;
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

describe("processingNotGatedByReadiness", () => {
  it("processing files must not gate on readiness checks", () => {
    const files = SCAN_TARGETS.flatMap(listTsFiles);

    const offenders: Array<{ file: string; reason: string }> = [];

    for (const filePath of files) {
      if (isAllowlisted(filePath)) continue;

      const content = fs.readFileSync(filePath, "utf8");

      // Only check files that reference readiness at all
      if (!READINESS_IMPORT_PATTERN.test(content)) continue;

      // If file references readiness AND has a gating pattern, flag it
      if (GATING_PATTERN.test(content)) {
        offenders.push({
          file: path.relative(process.cwd(), filePath),
          reason: "imports readiness AND has early return/throw conditioned on blockers/readiness",
        });
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `Processing files gate on readiness (violates processing independence):\n${
        offenders
          .map((o) => `  ${o.file}: ${o.reason}`)
          .join("\n")
      }`,
    );
  });

  it("scan targets exist and contain files", () => {
    // Ensures the guard is actually scanning something, not vacuously passing
    const files = SCAN_TARGETS.flatMap(listTsFiles);
    assert.ok(
      files.length > 0,
      `Expected scan targets to contain .ts files, found ${files.length}`,
    );
  });
});
