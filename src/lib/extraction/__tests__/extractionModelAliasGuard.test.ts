/**
 * SPEC-EXTRACTION-MODEL-UPGRADE-1 — extraction-lane model-alias guard.
 *
 * The document fact-extraction lane must resolve its model through the
 * MODEL_EXTRACTION intent-alias, NOT by importing GEMINI_FLASH directly.
 * A direct GEMINI_FLASH import silently pins extraction to Flash-Lite and
 * bypasses the registry alias that governs the lane (the exact anti-pattern
 * this spec fixed in geminiFlashStructuredAssist.ts).
 *
 * Source-grep guard, patterned after geminiFlashStructuredAssistLocationGuard.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, sep } from "node:path";

// Extraction model-resolution dirs in scope for this spec.
const SCAN_DIRS = [
  resolve(process.cwd(), "src/lib/extraction"),
  resolve(process.cwd(), "src/lib/extract"),
  resolve(process.cwd(), "src/lib/financialSpreads/extractors"),
];

// Matches `import { ..., GEMINI_FLASH, ... } from "@/lib/ai/models"` —
// the registry import that pins a lane to Flash-Lite. MODEL_EXTRACTION
// (and other aliases) are fine; only the raw GEMINI_FLASH constant is banned.
const BANNED_IMPORT_RE =
  /import\s*\{[^}]*\bGEMINI_FLASH\b[^}]*\}\s*from\s*["']@\/lib\/ai\/models["']/;

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // dir may not exist on a given branch
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip test dirs — guard fixtures legitimately mention the constant.
      if (name === "__tests__") continue;
      out.push(...walk(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

test("[extraction-model-alias-1] no direct GEMINI_FLASH import in the extraction lanes", () => {
  const offenders: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const src = readFileSync(file, "utf8");
      if (BANNED_IMPORT_RE.test(src)) {
        offenders.push(file.split(process.cwd() + sep)[1] ?? file);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Extraction lane must import MODEL_EXTRACTION, not GEMINI_FLASH directly:\n  ${offenders.join("\n  ")}`,
  );
});
