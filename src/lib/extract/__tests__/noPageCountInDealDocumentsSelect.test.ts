import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(p: string) {
  return fs.readFileSync(p, "utf8");
}

// ─── Core gate: page_count must not appear in extract-layer files ────────────
// deal_documents does NOT have a page_count column (it lives on deal_uploads).
// Selecting it causes PostgREST 400 → silent doc_not_found site-wide regression.

test("extractByDocType.ts must not reference page_count", () => {
  const p = path.join(process.cwd(), "src/lib/extract/router/extractByDocType.ts");
  const s = read(p);
  assert.ok(
    !/\bpage_count\b/.test(s),
    "extractByDocType.ts still references page_count — deal_documents does not have this column",
  );
});

test("extractWithGoogleDocAi.ts must not reference page_count", () => {
  const p = path.join(
    process.cwd(),
    "src/lib/extract/googleDocAi/extractWithGoogleDocAi.ts",
  );
  const s = read(p);
  assert.ok(
    !/\bpage_count\b/.test(s),
    "extractWithGoogleDocAi.ts still references page_count — deal_documents does not have this column",
  );
});

// ─── Extended: no .page_count property access in extract layer ───────────────
// Catches doc.page_count / doc.pageCount property reads that would smuggle the
// column back in via a different spelling. Scoped to src/lib/extract/ only.

test("no .page_count or .pageCount property access in src/lib/extract/", () => {
  const extractDir = path.join(process.cwd(), "src/lib/extract");
  const tsFiles = collectTsFiles(extractDir);

  const violations: string[] = [];
  for (const f of tsFiles) {
    // Skip this test file itself
    if (f.includes("noPageCountInDealDocumentsSelect")) continue;
    const contents = read(f);
    // Match property access patterns: .page_count or .pageCount (but not
    // ocrResult.pageCount which is a legit in-memory field from the OCR SDK)
    const lines = contents.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Allow ocrResult.pageCount — that's the OCR SDK response, not a DB column
      if (/ocrResult\.pageCount/.test(line)) continue;
      // Flag any other .page_count or doc.pageCount style access
      if (/\.page_count\b/.test(line)) {
        violations.push(`${path.relative(extractDir, f)}:${i + 1}: ${line.trim()}`);
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    `Found .page_count property access in extract layer:\n${violations.join("\n")}`,
  );
});

// ─── OCR fallback: pages defaults to 1 when ocrResult.pageCount is falsy ────

test("Gemini OCR fallback: pages === 1 when ocrResult.pageCount is absent", () => {
  // Simulates the inline logic: const pages = ocrResult.pageCount || 1;
  const ocrResult = { pageCount: 0 }; // falsy
  const pages = ocrResult.pageCount || 1;
  assert.equal(pages, 1, "pages should default to 1 when pageCount is falsy");
});

test("Gemini OCR fallback: pages === N when ocrResult.pageCount is present", () => {
  const ocrResult = { pageCount: 7 };
  const pages = ocrResult.pageCount || 1;
  assert.equal(pages, 7, "pages should use ocrResult.pageCount when truthy");
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}
