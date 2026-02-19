/**
 * PDF Segmentation v1.2 — Tripwire Tests
 *
 * Source-level structural invariants for CI enforcement.
 * Uses node:test + node:assert/strict + fs.readFileSync.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { SEGMENTATION_VERSION } from "../types";

const SEGMENTATION_DIR = path.join(
  process.cwd(),
  "src/lib/intake/segmentation",
);

function readFile(file: string): string {
  return fs.readFileSync(path.join(SEGMENTATION_DIR, file), "utf8");
}

// ---------------------------------------------------------------------------
// 1. segmentPdfText.ts does NOT contain import "server-only"
// ---------------------------------------------------------------------------

test("Tripwire: segmentPdfText.ts does NOT import server-only", () => {
  const src = readFile("segmentPdfText.ts");
  const hasServerOnly = /import\s+["']server-only["']/.test(src);
  assert.ok(
    !hasServerOnly,
    "segmentPdfText.ts must NOT import server-only — pure module",
  );
});

// ---------------------------------------------------------------------------
// 2. segmentPdfText.ts does NOT contain supabaseAdmin
// ---------------------------------------------------------------------------

test("Tripwire: segmentPdfText.ts does NOT contain supabaseAdmin", () => {
  const src = readFile("segmentPdfText.ts");
  assert.ok(
    !src.includes("supabaseAdmin"),
    "segmentPdfText.ts must NOT reference supabaseAdmin — pure module",
  );
});

// ---------------------------------------------------------------------------
// 3. SEGMENTATION_VERSION starts with "v1.2"
// ---------------------------------------------------------------------------

test("Tripwire: SEGMENTATION_VERSION starts with 'v1.2'", () => {
  assert.ok(
    SEGMENTATION_VERSION.startsWith("v1.2"),
    `SEGMENTATION_VERSION must start with 'v1.2', got: ${SEGMENTATION_VERSION}`,
  );
});

// ---------------------------------------------------------------------------
// 4. segmentPdfText.ts does NOT contain Math.random, Date.now, or crypto.randomUUID
// ---------------------------------------------------------------------------

test("Tripwire: segmentPdfText.ts has no non-deterministic calls", () => {
  const src = readFile("segmentPdfText.ts");
  assert.ok(
    !src.includes("Math.random"),
    "segmentPdfText.ts must not use Math.random — determinism invariant",
  );
  assert.ok(
    !src.includes("Date.now"),
    "segmentPdfText.ts must not use Date.now — determinism invariant",
  );
  assert.ok(
    !src.includes("crypto.randomUUID"),
    "segmentPdfText.ts must not use crypto.randomUUID — determinism invariant",
  );
});

// ---------------------------------------------------------------------------
// 5. types.ts does NOT import any external modules
// ---------------------------------------------------------------------------

test("Tripwire: types.ts has no external imports", () => {
  const src = readFile("types.ts");
  // Match any import statement that is not type-only from the same directory
  const importStatements = [...src.matchAll(/^import\s+(?!type\b)/gm)];
  // Filter out re-exports — only check actual import lines
  const nonTypeImports = importStatements.filter((m) => {
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const lineEnd = src.indexOf("\n", m.index!);
    const line = src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    // Allow: export const, export type — these aren't imports
    return line.trimStart().startsWith("import");
  });
  assert.equal(
    nonTypeImports.length,
    0,
    `types.ts should have no non-type imports, found: ${nonTypeImports.map((m) => m[0]).join(", ")}`,
  );
});
