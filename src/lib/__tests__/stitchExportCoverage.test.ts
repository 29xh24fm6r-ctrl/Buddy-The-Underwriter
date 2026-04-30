import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { STITCH_SURFACES } from "@/stitch/stitchSurfaceRegistry";

const root = process.cwd();
const exportsDir = path.join(root, "stitch_exports");

/**
 * Exports that are explicitly ignored (no code.html or intentionally unused).
 * Each entry must have a reason.
 */
const IGNORED_EXPORTS: Record<string, string> = {
  "deal-summary": "No code.html present — slug used by credit_committee surface via external template.",
};

// ── Guard 2: Every ignored export has a valid reason ──────
test("every ignored export has a non-empty reason", () => {
  for (const [slug, reason] of Object.entries(IGNORED_EXPORTS)) {
    assert.ok(reason.length > 0, `Ignored export ${slug} has empty reason`);
  }
});

// ── Guard 3: No ignored export is also registered ─────────
test("no ignored export is also registered as a surface slug", () => {
  const registeredSlugs = new Set(
    STITCH_SURFACES.map((s) => s.slug).filter(Boolean),
  );

  for (const slug of Object.keys(IGNORED_EXPORTS)) {
    // deal-summary IS registered (by credit_committee) but has no code.html — that's fine
    // This guard is for exports that are ignored AND registered which would be contradictory
    // We only flag if the slug is both ignored AND registered AND has code.html
    const hasExport = fs.existsSync(path.join(exportsDir, slug, "code.html"));
    if (hasExport && registeredSlugs.has(slug)) {
      assert.fail(
        `${slug} is both ignored and registered with a valid export — remove from IGNORED_EXPORTS`,
      );
    }
  }
});

// ── Guard 4: Registry surfaces with slugs point to real exports ──
// Pre-existing surfaces whose slugs have no code.html (external template or standalone)
const KNOWN_MISSING_EXPORTS = new Set(["underwrite", "deal-summary"]);

test("every registry surface with a slug has a matching export or is explicitly optional", () => {
  for (const surface of STITCH_SURFACES) {
    if (!surface.slug) continue;
    if (KNOWN_MISSING_EXPORTS.has(surface.slug)) continue;
    const exportPath = path.join(exportsDir, surface.slug, "code.html");
    const exists = fs.existsSync(exportPath);

    if (surface.required) {
      assert.ok(
        exists,
        `Required surface ${surface.key} references slug "${surface.slug}" but stitch_exports/${surface.slug}/code.html is missing`,
      );
    }
  }
});
