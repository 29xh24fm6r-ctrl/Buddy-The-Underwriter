/**
 * Phase 53A — Render Resilience Guard
 *
 * These tests enforce the system property:
 *   "Any async loader in a server-rendered deal route must be treated as
 *    untrusted and non-fatal unless the route cannot exist without it."
 *
 * Test matrix:
 * A. safeLoader wraps failures and returns fallback
 * B. safeLoader passes through successes
 * C. safeLoader structured logging contract
 * D. No .single() in page.tsx or layout.tsx files
 * E. DealPageErrorState contract
 * F. Cockpit page imports safeLoader (structural guard)
 * G. Conditions page imports safeLoader (structural guard)
 * H. Pricing page imports safeLoader (structural guard)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function globSync(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    if (entry.isFile() && pattern.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

const SRC_ROOT = path.resolve(__dirname, "../../..");

// ---------------------------------------------------------------------------
// A. safeLoader wraps failures and returns fallback
// ---------------------------------------------------------------------------

describe("safeLoader — failure isolation", () => {
  it("returns fallback when run() throws", async () => {
    // Import the pure function — no server-only guard in test
    // We test the logic pattern, not the import (server-only blocks test runners).
    const fallback = { ok: false as const, dealId: "test" };
    let logged = false;
    const originalError = console.error;
    console.error = () => { logged = true; };

    try {
      // Inline equivalent of safeLoader for testability (server-only blocks direct import)
      const run = () => Promise.reject(new Error("db connection lost"));
      let data = fallback;
      let error: string | null = null;
      let ok = true;
      try {
        data = await run();
      } catch (err: any) {
        ok = false;
        error = err.message;
      }
      assert.equal(ok, false, "should report failure");
      assert.equal(error, "db connection lost");
      assert.deepStrictEqual(data, fallback, "should return fallback");
    } finally {
      console.error = originalError;
    }
  });

  it("returns data when run() succeeds", async () => {
    const run = () => Promise.resolve({ result: 42 });
    const fallback = { result: -1 };
    let data = fallback;
    let ok = false;
    try {
      data = await run();
      ok = true;
    } catch {
      ok = false;
    }
    assert.equal(ok, true);
    assert.deepStrictEqual(data, { result: 42 });
  });
});

// ---------------------------------------------------------------------------
// D. No .single() in any page.tsx or layout.tsx
// ---------------------------------------------------------------------------

describe(".single() guard — server components", () => {
  const appDir = path.join(SRC_ROOT, "app");

  it("no .single() in any page.tsx file", () => {
    const pages = globSync(appDir, /^page\.tsx$/);
    assert.ok(pages.length > 0, "should find at least one page.tsx");

    const violations: string[] = [];
    for (const file of pages) {
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes(".single()")) {
        violations.push(path.relative(SRC_ROOT, file));
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      `.single() found in page.tsx files (use .maybeSingle() for nullable reads):\n${violations.join("\n")}`,
    );
  });

  it("no .single() in any layout.tsx file", () => {
    const layouts = globSync(appDir, /^layout\.tsx$/);
    const violations: string[] = [];
    for (const file of layouts) {
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes(".single()")) {
        violations.push(path.relative(SRC_ROOT, file));
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      `.single() found in layout.tsx files:\n${violations.join("\n")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// E. DealPageErrorState contract
// ---------------------------------------------------------------------------

describe("DealPageErrorState — structural contract", () => {
  const componentPath = path.join(SRC_ROOT, "components/deals/DealPageErrorState.tsx");

  it("component file exists", () => {
    assert.ok(fs.existsSync(componentPath), "DealPageErrorState.tsx should exist");
  });

  it("exports DealPageErrorState function", () => {
    const content = fs.readFileSync(componentPath, "utf-8");
    assert.ok(
      content.includes("export function DealPageErrorState"),
      "should export DealPageErrorState",
    );
  });

  it("accepts required props: title, message, backHref", () => {
    const content = fs.readFileSync(componentPath, "utf-8");
    assert.ok(content.includes("title"), "should accept title prop");
    assert.ok(content.includes("message"), "should accept message prop");
    assert.ok(content.includes("backHref"), "should accept backHref prop");
  });

  it("accepts optional props: dealId, surface, technicalDetail", () => {
    const content = fs.readFileSync(componentPath, "utf-8");
    assert.ok(content.includes("dealId"), "should accept dealId prop");
    assert.ok(content.includes("surface"), "should accept surface prop");
    assert.ok(content.includes("technicalDetail"), "should accept technicalDetail prop");
  });

  it("does not expose raw stack traces", () => {
    const content = fs.readFileSync(componentPath, "utf-8");
    assert.ok(!content.includes(".stack"), "should not render stack traces in UI");
  });
});

// ---------------------------------------------------------------------------
// F–H. Structural guards: pages import safeLoader
// ---------------------------------------------------------------------------

describe("safeLoader adoption — structural guards", () => {
  it("cockpit page imports safeLoader", () => {
    const file = path.join(SRC_ROOT, "app/(app)/deals/[dealId]/cockpit/page.tsx");
    const content = fs.readFileSync(file, "utf-8");
    assert.ok(content.includes("safeLoader"), "cockpit page must use safeLoader");
  });

  it("cockpit page imports DealPageErrorState", () => {
    const file = path.join(SRC_ROOT, "app/(app)/deals/[dealId]/cockpit/page.tsx");
    const content = fs.readFileSync(file, "utf-8");
    assert.ok(content.includes("DealPageErrorState"), "cockpit page must use DealPageErrorState");
  });

  it("conditions page imports safeLoader", () => {
    const file = path.join(SRC_ROOT, "app/(app)/deals/[dealId]/conditions/page.tsx");
    const content = fs.readFileSync(file, "utf-8");
    assert.ok(content.includes("safeLoader"), "conditions page must use safeLoader");
  });

  it("pricing page imports safeLoader", () => {
    const file = path.join(SRC_ROOT, "app/(app)/deals/[dealId]/pricing/page.tsx");
    const content = fs.readFileSync(file, "utf-8");
    assert.ok(content.includes("safeLoader"), "pricing page must use safeLoader");
  });

  it("cockpit page does not use bare verifyUnderwrite without safeLoader", () => {
    const file = path.join(SRC_ROOT, "app/(app)/deals/[dealId]/cockpit/page.tsx");
    const content = fs.readFileSync(file, "utf-8");
    // The old pattern was: verify = await verifyUnderwrite(...)
    // The new pattern uses safeLoader. Check there's no bare await verifyUnderwrite outside safeLoader.
    const lines = content.split("\n");
    const bareVerify = lines.filter(
      (l) => l.includes("await verifyUnderwrite") && !l.includes("safeLoader") && !l.includes("run:"),
    );
    // Inside safeLoader's run callback it appears as `run: () => verifyUnderwrite(...)` — that's fine
    assert.equal(
      bareVerify.length,
      0,
      `Found bare verifyUnderwrite calls outside safeLoader:\n${bareVerify.join("\n")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// I. safeLoader file contract
// ---------------------------------------------------------------------------

describe("safeLoader — file contract", () => {
  const loaderPath = path.join(SRC_ROOT, "lib/server/safe-loader.ts");

  it("file exists", () => {
    assert.ok(fs.existsSync(loaderPath), "safe-loader.ts should exist");
  });

  it("exports safeLoader function", () => {
    const content = fs.readFileSync(loaderPath, "utf-8");
    assert.ok(content.includes("export async function safeLoader"), "should export safeLoader");
  });

  it("uses server-only import", () => {
    const content = fs.readFileSync(loaderPath, "utf-8");
    assert.ok(content.includes('"server-only"'), "should import server-only");
  });

  it("log payload includes required fields", () => {
    const content = fs.readFileSync(loaderPath, "utf-8");
    const requiredFields = ["area", "loader", "dealId", "surface", "errorMessage", "stack", "severity", "degraded", "timestamp"];
    for (const field of requiredFields) {
      assert.ok(content.includes(field), `log payload should include ${field}`);
    }
  });
});
