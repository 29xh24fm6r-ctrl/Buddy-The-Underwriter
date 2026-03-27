import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { STITCH_SURFACES } from "@/stitch/stitchSurfaceRegistry";

const root = process.cwd();
const exportsDir = path.join(root, "stitch_exports");

// ── Guard 1: Every required surface has a unique route ─────
test("every required surface has a unique route", () => {
  const required = STITCH_SURFACES.filter((s) => s.required);
  const routes = required.map((s) => s.route);
  const unique = new Set(routes);
  assert.equal(routes.length, unique.size, `Duplicate routes: ${routes.filter((r, i) => routes.indexOf(r) !== i).join(", ")}`);
});

// ── Guard 2: Every required surface has a unique (route+slug) pair ──
test("every required surface has a unique route+slug combination", () => {
  const required = STITCH_SURFACES.filter((s) => s.required);
  const pairs = required.map((s) => `${s.route}::${s.slug}`);
  const unique = new Set(pairs);
  assert.equal(pairs.length, unique.size, `Duplicate route+slug pairs: ${pairs.filter((p, i) => pairs.indexOf(p) !== i).join(", ")}`);
});

// ── Guard 3: Every required surface pagePath exists ────────
test("every required surface pagePath exists on disk", () => {
  const required = STITCH_SURFACES.filter((s) => s.required);
  for (const surface of required) {
    assert.ok(surface.pagePath, `${surface.key} missing pagePath in registry`);
    const absolute = path.resolve(root, surface.pagePath!);
    assert.ok(fs.existsSync(absolute), `${surface.key} pagePath missing: ${surface.pagePath}`);
  }
});

// ── Guard 4: Every required surface slug has a matching stitch export ──
// Pre-existing surfaces whose slugs have no code.html (external template or standalone)
const KNOWN_MISSING_EXPORTS = new Set(["underwrite", "deal-summary"]);

test("every required surface slug has a matching stitch export", () => {
  const required = STITCH_SURFACES.filter((s) => s.required);
  for (const surface of required) {
    if (!surface.slug) continue;
    if (KNOWN_MISSING_EXPORTS.has(surface.slug)) continue;
    const exportPath = path.join(exportsDir, surface.slug, "code.html");
    assert.ok(
      fs.existsSync(exportPath),
      `${surface.key} export missing: stitch_exports/${surface.slug}/code.html`,
    );
  }
});

// ── Guard 5: Every required surface pagePath renders StitchSurface ──
test("every required surface pagePath references StitchSurface", () => {
  const required = STITCH_SURFACES.filter((s) => s.required);
  for (const surface of required) {
    assert.ok(surface.pagePath, `${surface.key} missing pagePath`);
    const absolute = path.resolve(root, surface.pagePath!);
    const content = fs.readFileSync(absolute, "utf8");
    assert.ok(
      content.includes("StitchSurface"),
      `${surface.key} at ${surface.pagePath} does not reference StitchSurface`,
    );
  }
});

// ── Guard 6: Every required surface pagePath is covered by tracing ──
test("every required surface pagePath is covered by tracing includes", () => {
  const configPath = path.resolve(root, "next.config.mjs");
  const configContent = fs.readFileSync(configPath, "utf8");

  const required = STITCH_SURFACES.filter((s) => s.required);
  for (const surface of required) {
    if (!surface.pagePath) continue;
    // Check that the pagePath (or a glob covering it) appears in the config
    const basename = path.basename(surface.pagePath);
    const parentDir = path.basename(path.dirname(surface.pagePath));
    assert.ok(
      configContent.includes(basename) && configContent.includes(parentDir),
      `${surface.key} pagePath not found in next.config.mjs tracing: ${surface.pagePath}`,
    );
  }
});

// ── Guard 7: No two surfaces share the same key ───────────
test("every surface key is unique", () => {
  const keys = STITCH_SURFACES.map((s) => s.key);
  const unique = new Set(keys);
  assert.equal(keys.length, unique.size, "Duplicate surface keys found");
});
