import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { STITCH_SURFACES } from "@/stitch/stitchSurfaceRegistry";

const root = process.cwd();
const exportsDir = path.join(root, "stitch_exports");

// ── Guard 1: No orphaned exports ──────────────────────────
test("audit: no orphaned stitch exports exist", () => {
  const registeredSlugs = new Set(
    STITCH_SURFACES.map((s) => s.slug).filter(Boolean),
  );

  const dirs = fs.readdirSync(exportsDir, { withFileTypes: true });
  const orphaned: string[] = [];

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    if (!fs.existsSync(path.join(exportsDir, dir.name, "code.html"))) continue;
    if (!registeredSlugs.has(dir.name)) {
      orphaned.push(dir.name);
    }
  }

  // deal-summary has no code.html so it won't appear here
  assert.equal(
    orphaned.length,
    0,
    `Orphaned exports: ${orphaned.join(", ")}`,
  );
});

// ── Guard 2: No missing wrappers for required surfaces ────
test("audit: no missing wrappers for required surfaces", () => {
  const required = STITCH_SURFACES.filter((s) => s.required);
  const missing: string[] = [];

  for (const surface of required) {
    if (!surface.pagePath) {
      missing.push(`${surface.key} (no pagePath)`);
      continue;
    }
    const absolute = path.resolve(root, surface.pagePath);
    if (!fs.existsSync(absolute)) {
      missing.push(`${surface.key} (file missing: ${surface.pagePath})`);
      continue;
    }
    const content = fs.readFileSync(absolute, "utf8");
    if (!content.includes("StitchSurface")) {
      missing.push(`${surface.key} (no StitchSurface ref)`);
    }
  }

  assert.equal(
    missing.length,
    0,
    `Missing wrappers: ${missing.join("; ")}`,
  );
});

// ── Guard 3: No route collisions ──────────────────────────
test("audit: no route collisions in registry", () => {
  const routeMap = new Map<string, string[]>();
  for (const surface of STITCH_SURFACES) {
    const existing = routeMap.get(surface.route) ?? [];
    existing.push(surface.key);
    routeMap.set(surface.route, existing);
  }

  const collisions: string[] = [];
  for (const [route, keys] of routeMap) {
    if (keys.length > 1) {
      collisions.push(`${route} -> [${keys.join(", ")}]`);
    }
  }

  assert.equal(
    collisions.length,
    0,
    `Route collisions: ${collisions.join("; ")}`,
  );
});

// ── Guard 4: Tracing config includes stitch_exports glob ──
test("audit: tracing config includes stitch_exports for Vercel bundle", () => {
  const configPath = path.resolve(root, "next.config.mjs");
  const configContent = fs.readFileSync(configPath, "utf8");

  assert.ok(
    configContent.includes("stitch_exports/**/code.html"),
    "next.config.mjs must include stitch_exports/**/code.html in outputFileTracingIncludes",
  );

  // Verify route keys are present (not just pagePath basenames)
  assert.ok(
    configContent.includes('"/analytics"'),
    "Route /analytics must be in tracing config",
  );
  assert.ok(
    configContent.includes('"/servicing"'),
    "Route /servicing must be in tracing config",
  );
});

// ── Guard 5: Audit route file exists ──────────────────────
test("audit: audit route file exists", () => {
  const auditRoute = path.resolve(root, "src/app/api/builder/stitch/audit/route.ts");
  assert.ok(fs.existsSync(auditRoute), "Audit route file missing");
});

// ── Guard 6: Recovery routes are not required ─────────────
test("audit: recovery routes are optional (not required)", () => {
  const recoveryRoutes = STITCH_SURFACES.filter(
    (s) => s.route.startsWith("/stitch-recovery") || s.route === "/stitch-login",
  );

  for (const surface of recoveryRoutes) {
    assert.equal(
      surface.required,
      false,
      `Recovery route ${surface.key} should not be required`,
    );
  }
});
