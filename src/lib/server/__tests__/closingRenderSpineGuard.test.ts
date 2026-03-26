/**
 * Phase 56C.1 — Closing Render Spine CI Guard
 *
 * Suites:
 * 1. Render snapshot contract
 * 2. Checksum contract
 * 3. Render execution contract
 * 4. Diff contract
 * 5. Migration tables
 * 6. Placeholder regression
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), "utf-8");
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(SRC_ROOT, relPath));
}

// ---------------------------------------------------------------------------
// 1. Render snapshot
// ---------------------------------------------------------------------------

describe("Closing render snapshot — contract", () => {
  it("buildClosingRenderSnapshot exists", () => {
    assert.ok(fileExists("lib/closing/render/buildClosingRenderSnapshot.ts"));
  });

  it("includes schema version", () => {
    const content = readFile("lib/closing/render/buildClosingRenderSnapshot.ts");
    assert.ok(content.includes("schemaVersion"), "must include schemaVersion");
    assert.ok(content.includes("2026-03-56C1"), "must use correct schema version");
  });

  it("freezes deal + borrower + facilities + collateral + guarantors + covenants", () => {
    const content = readFile("lib/closing/render/buildClosingRenderSnapshot.ts");
    assert.ok(content.includes("borrower"), "must include borrower data");
    assert.ok(content.includes("facilities"), "must include facilities");
    assert.ok(content.includes("collateral"), "must include collateral");
    assert.ok(content.includes("guarantors"), "must include guarantors");
    assert.ok(content.includes("covenants"), "must include covenants");
  });

  it("includes closing context (package version, template code)", () => {
    const content = readFile("lib/closing/render/buildClosingRenderSnapshot.ts");
    assert.ok(content.includes("closingContext"), "must include closing context");
    assert.ok(content.includes("packageVersion"), "must include package version");
    assert.ok(content.includes("templateCode"), "must include template code");
  });
});

// ---------------------------------------------------------------------------
// 2. Checksum
// ---------------------------------------------------------------------------

describe("Render checksum — contract", () => {
  it("computeRenderChecksum exists", () => {
    assert.ok(fileExists("lib/closing/render/computeRenderChecksum.ts"));
  });

  it("exports input and output checksum functions", () => {
    const content = readFile("lib/closing/render/computeRenderChecksum.ts");
    assert.ok(content.includes("computeInputChecksum"), "must export input checksum");
    assert.ok(content.includes("computeOutputChecksum"), "must export output checksum");
  });

  it("uses stable key-sorted JSON serialization", () => {
    const content = readFile("lib/closing/render/computeRenderChecksum.ts");
    assert.ok(content.includes("sort"), "must sort keys for determinism");
    assert.ok(content.includes("sha256"), "must use sha256");
  });
});

// ---------------------------------------------------------------------------
// 3. Render execution
// ---------------------------------------------------------------------------

describe("Render execution — contract", () => {
  it("renderClosingPackageDocument exists", () => {
    assert.ok(fileExists("lib/closing/render/renderClosingPackageDocument.ts"));
  });

  it("creates render record before rendering", () => {
    const content = readFile("lib/closing/render/renderClosingPackageDocument.ts");
    assert.ok(content.includes("closing_document_renders"), "must create render record");
    assert.ok(content.includes('"rendering"'), "must set status to rendering first");
  });

  it("updates package document with render linkage", () => {
    const content = readFile("lib/closing/render/renderClosingPackageDocument.ts");
    assert.ok(content.includes("current_render_id"), "must update current_render_id");
    assert.ok(content.includes("render_status"), "must update render_status");
  });

  it("handles failures with error state", () => {
    const content = readFile("lib/closing/render/renderClosingPackageDocument.ts");
    assert.ok(content.includes('"failed"'), "must set failed status");
    assert.ok(content.includes("render_error"), "must record render error");
  });

  it("emits audit events for success and failure", () => {
    const content = readFile("lib/closing/render/renderClosingPackageDocument.ts");
    assert.ok(content.includes("render.succeeded"), "must emit success event");
    assert.ok(content.includes("render.failed"), "must emit failure event");
  });
});

// ---------------------------------------------------------------------------
// 4. Diff
// ---------------------------------------------------------------------------

describe("Render diff — contract", () => {
  it("diffClosingPackageRenders exists", () => {
    assert.ok(fileExists("lib/closing/render/diffClosingPackageRenders.ts"));
  });

  it("detects added, removed, changed, and unchanged documents", () => {
    const content = readFile("lib/closing/render/diffClosingPackageRenders.ts");
    assert.ok(content.includes("addedDocuments"), "must detect added");
    assert.ok(content.includes("removedDocuments"), "must detect removed");
    assert.ok(content.includes("changedInputs"), "must detect changed inputs");
    assert.ok(content.includes("unchanged"), "must detect unchanged");
  });

  it("compares by checksum, not content", () => {
    const content = readFile("lib/closing/render/diffClosingPackageRenders.ts");
    assert.ok(content.includes("renderInputChecksum"), "must compare input checksums");
    assert.ok(content.includes("outputChecksum"), "must compare output checksums");
  });
});

// ---------------------------------------------------------------------------
// 5. Migration
// ---------------------------------------------------------------------------

describe("Render spine migration — tables", () => {
  it("creates closing_document_renders table", () => {
    const content = readFile("../supabase/migrations/20260326_closing_render_spine.sql");
    assert.ok(content.includes("closing_document_renders"), "must create renders table");
  });

  it("renders table has snapshot + checksum columns", () => {
    const content = readFile("../supabase/migrations/20260326_closing_render_spine.sql");
    assert.ok(content.includes("render_input_snapshot"), "must have input snapshot");
    assert.ok(content.includes("render_input_checksum"), "must have input checksum");
    assert.ok(content.includes("output_checksum"), "must have output checksum");
  });

  it("extends closing_package_documents with render linkage", () => {
    const content = readFile("../supabase/migrations/20260326_closing_render_spine.sql");
    assert.ok(content.includes("current_render_id"), "must add current_render_id");
    assert.ok(content.includes("render_status"), "must add render_status");
    assert.ok(content.includes("rendered_at"), "must add rendered_at");
  });
});

// ---------------------------------------------------------------------------
// 6. Placeholder regression
// ---------------------------------------------------------------------------

describe("Render spine — no placeholders", () => {
  it("modules have no placeholder markers", () => {
    const files = [
      "lib/closing/render/buildClosingRenderSnapshot.ts",
      "lib/closing/render/computeRenderChecksum.ts",
      "lib/closing/render/renderClosingPackageDocument.ts",
      "lib/closing/render/diffClosingPackageRenders.ts",
    ];
    for (const f of files) {
      const content = readFile(f);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\bTODO\b|placeholder|coming soon/i.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          assert.fail(`Placeholder in ${f}:${i + 1}: ${line.trim()}`);
        }
      }
    }
  });
});
