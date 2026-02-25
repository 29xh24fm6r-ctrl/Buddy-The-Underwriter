/**
 * Extraction Invariant Guards
 *
 * 8 architectural invariant tests that verify the extraction system
 * maintains its safety properties:
 *
 *   1. LLM output cannot alter canonical_type
 *   2. LLM output cannot bypass deterministic validator
 *   3. Slot binding never depends on structuredJson
 *   4. Missing structuredJson still allows OCR regex fallback
 *   5. ExtractionPath is observational
 *   6. Gemini Flash timeout returns null
 *   7. Structured JSON lives in existing storage
 *   8. Zero @google-cloud/documentai imports
 *
 * Pure structural assertions — no DB, no IO, no server-only imports.
 * Uses fs.readFileSync to inspect source code where necessary.
 */

import { describe, test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a project-root-relative path to an absolute path. */
function srcPath(relativePath: string): string {
  return path.resolve(__dirname, "../../../..", relativePath);
}

/** Read a source file as a UTF-8 string. */
function readSource(relativePath: string): string {
  const abs = srcPath(relativePath);
  return fs.readFileSync(abs, "utf-8");
}

/** Recursively collect all .ts files under a directory. */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe("Extraction Invariant Guards", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Guard 1: LLM output cannot alter canonical_type
  // ─────────────────────────────────────────────────────────────────────────

  test("Guard 1: StructuredAssistResult type does NOT have a canonical_type field", () => {
    const source = readSource(
      "src/lib/extraction/geminiFlashStructuredAssist.ts",
    );

    // The StructuredAssistResult type must not include canonical_type as a field.
    // We check the type definition block — look for the type declaration and
    // verify no `canonical_type` property exists inside it.
    const typeBlockMatch = source.match(
      /export\s+type\s+StructuredAssistResult\s*=\s*\{([\s\S]*?)\n\};/,
    );
    assert.ok(
      typeBlockMatch,
      "StructuredAssistResult type definition must exist in geminiFlashStructuredAssist.ts",
    );

    const typeBody = typeBlockMatch![1];
    assert.ok(
      !typeBody.includes("canonical_type"),
      "StructuredAssistResult must NOT contain a canonical_type field — LLM output must never alter classification",
    );

    // Also verify the function itself does not write to deal_documents or canonical_type
    assert.ok(
      !source.includes('.update({ canonical_type'),
      "extractStructuredAssist must NOT write canonical_type to deal_documents",
    );
    assert.ok(
      !source.includes(".update({ doc_type"),
      "extractStructuredAssist must NOT write doc_type to deal_documents",
    );

    console.log(
      "[extractionInvariantGuard] Guard 1: LLM output cannot alter canonical_type -- PASSED",
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Guard 2: LLM output cannot bypass deterministic validator
  // ─────────────────────────────────────────────────────────────────────────

  test("Guard 2: extractFactsFromDocument still calls validation functions", () => {
    const source = readSource(
      "src/lib/financialSpreads/extractFactsFromDocument.ts",
    );

    // The extraction pipeline must call the validation layer after extraction.
    // We check for the import or dynamic import of validateExtractedFinancials
    // and the actual invocation of runValidationGate (D1: gating validation).
    const hasValidationImport =
      source.includes("validateExtractedFinancials") ||
      source.includes("runValidationGate");

    assert.ok(
      hasValidationImport,
      "extractFactsFromDocument must reference validation functions (validateExtractedFinancials or runValidationGate) — LLM output cannot bypass deterministic validators",
    );

    // Verify that validation is actually called (not just imported)
    assert.ok(
      source.includes("runValidationGate(") || source.includes("validateExtractionQuality("),
      "extractFactsFromDocument must CALL runValidationGate() or validateExtractionQuality() — import alone is insufficient",
    );

    console.log(
      "[extractionInvariantGuard] Guard 2: LLM output cannot bypass deterministic validator -- PASSED",
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Guard 3: Slot binding never depends on structuredJson
  // ─────────────────────────────────────────────────────────────────────────

  test("Guard 3: matchEngine.ts does NOT reference structuredJson", () => {
    const source = readSource("src/lib/intake/matching/matchEngine.ts");

    assert.ok(
      !source.includes("structuredJson"),
      "matchEngine.ts must NOT reference structuredJson — slot binding must be independent of LLM-extracted structured data",
    );

    assert.ok(
      !source.includes("structured_json"),
      "matchEngine.ts must NOT reference structured_json — slot binding must be independent of LLM-extracted structured data",
    );

    console.log(
      "[extractionInvariantGuard] Guard 3: Slot binding never depends on structuredJson -- PASSED",
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Guard 4: Missing structuredJson still allows OCR regex fallback
  // ─────────────────────────────────────────────────────────────────────────

  test("Guard 4: DeterministicExtractorArgs.structuredJson is optional", () => {
    const source = readSource(
      "src/lib/financialSpreads/extractors/deterministic/types.ts",
    );

    // The structuredJson field must be optional (marked with `?`) so that
    // deterministic extractors can fall back to OCR regex when no structured
    // JSON is available.
    const hasOptionalStructuredJson = /structuredJson\s*\?/.test(source);

    assert.ok(
      hasOptionalStructuredJson,
      "DeterministicExtractorArgs.structuredJson must be optional (?) — missing structured JSON must allow OCR regex fallback",
    );

    console.log(
      "[extractionInvariantGuard] Guard 4: Missing structuredJson still allows OCR regex fallback -- PASSED",
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Guard 5: ExtractionPath is observational
  // ─────────────────────────────────────────────────────────────────────────

  test("Guard 5: validateExtractedFinancials.ts does NOT reference ExtractionPath", () => {
    const source = readSource(
      "src/lib/spreads/preflight/validateExtractedFinancials.ts",
    );

    assert.ok(
      !source.includes("extractionPath"),
      "validateExtractedFinancials.ts must NOT reference extractionPath — ExtractionPath is observational only and must not affect validation",
    );

    assert.ok(
      !source.includes("ExtractionPath"),
      "validateExtractedFinancials.ts must NOT reference ExtractionPath type — validators must be path-agnostic",
    );

    console.log(
      "[extractionInvariantGuard] Guard 5: ExtractionPath is observational -- PASSED",
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Guard 6: Gemini Flash timeout returns null
  // ─────────────────────────────────────────────────────────────────────────

  test("Guard 6: geminiFlashStructuredAssist.ts has timeout and catch-null pattern", () => {
    const source = readSource(
      "src/lib/extraction/geminiFlashStructuredAssist.ts",
    );

    // Must have a timeout mechanism
    const hasTimeout =
      source.includes("STRUCTURED_ASSIST_TIMEOUT_MS") ||
      source.includes("setTimeout") ||
      source.includes("Promise.race");
    assert.ok(
      hasTimeout,
      "geminiFlashStructuredAssist.ts must have a timeout mechanism (STRUCTURED_ASSIST_TIMEOUT_MS / Promise.race / setTimeout)",
    );

    // Must have Promise.race for enforcing the timeout
    assert.ok(
      source.includes("Promise.race"),
      "geminiFlashStructuredAssist.ts must use Promise.race to enforce hard timeout",
    );

    // Must have a catch clause that returns null (never throws)
    assert.ok(
      source.includes("catch"),
      "geminiFlashStructuredAssist.ts must have a catch clause",
    );
    assert.ok(
      source.includes("return null"),
      "geminiFlashStructuredAssist.ts must return null on failure (never throw)",
    );

    console.log(
      "[extractionInvariantGuard] Guard 6: Gemini Flash timeout returns null -- PASSED",
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Guard 7: Structured JSON lives in existing storage
  // ─────────────────────────────────────────────────────────────────────────

  test("Guard 7: no migration files with structured_assist or structured_json in name", () => {
    const migrationsDir = srcPath("supabase/migrations");

    assert.ok(
      fs.existsSync(migrationsDir),
      "supabase/migrations directory must exist",
    );

    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"));

    const violating = migrationFiles.filter((f) => {
      const lower = f.toLowerCase();
      return (
        lower.includes("structured_assist") ||
        lower.includes("structured_json")
      );
    });

    assert.strictEqual(
      violating.length,
      0,
      `No migration files should create new tables for structured assist/JSON — structured JSON must live in existing storage (document_extracts.fields_json). Violating files: ${violating.join(", ")}`,
    );

    console.log(
      `[extractionInvariantGuard] Guard 7: Structured JSON lives in existing storage (checked ${migrationFiles.length} migrations) -- PASSED`,
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Guard 8: Zero @google-cloud/documentai imports
  // ─────────────────────────────────────────────────────────────────────────

  test("Guard 8: no .ts files in src/ import @google-cloud/documentai at top level", () => {
    const srcDir = srcPath("src");
    const allTsFiles = collectTsFiles(srcDir);

    assert.ok(
      allTsFiles.length > 0,
      "Must find at least one .ts file in src/ to validate",
    );

    const violating: string[] = [];

    for (const filePath of allTsFiles) {
      const content = fs.readFileSync(filePath, "utf-8");

      // Allow `import type { ... } from "@google-cloud/documentai"` (compile-time only)
      // Allow `await import("@google-cloud/documentai")` (dynamic runtime import)
      // Disallow static `import { ... } from "@google-cloud/documentai"` (top-level bundled import)

      // Split into lines to check for non-type, non-dynamic imports
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();

        // Skip type-only imports — these are safe (compile-time erasure)
        if (/^import\s+type\s/.test(trimmed)) continue;

        // Skip dynamic imports — these are safe (runtime-only, no webpack bundle)
        if (/await\s+import\s*\(/.test(trimmed)) continue;

        // Skip comments
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

        // Flag any remaining line that imports from @google-cloud/documentai
        if (
          trimmed.includes('@google-cloud/documentai') &&
          /^import\s/.test(trimmed)
        ) {
          violating.push(
            `${path.relative(srcDir, filePath)}: ${trimmed}`,
          );
        }
      }
    }

    assert.strictEqual(
      violating.length,
      0,
      `No .ts files should have static (non-type, non-dynamic) imports of @google-cloud/documentai. Pattern: use "import type" for types + dynamic "import()" at runtime. Violating:\n${violating.join("\n")}`,
    );

    console.log(
      `[extractionInvariantGuard] Guard 8: Zero @google-cloud/documentai static imports (scanned ${allTsFiles.length} files) -- PASSED`,
    );
  });
});
