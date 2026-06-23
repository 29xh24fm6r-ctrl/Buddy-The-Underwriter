import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { STITCH_SURFACES } from "@/stitch/stitchSurfaceRegistry";

const root = process.cwd();
const exportsDir = path.join(root, "stitch_exports");

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

// ── Guard 5: Audit route stays removed (gating-by-absence) ─
// The builder/stitch/audit route was removed in 824c90f7 (dead-route cleanup
// for the Vercel route cap). Pin its removal: if re-introduced, restore the
// route-existence expectation alongside it.
test("audit: builder stitch/audit route stays removed", () => {
  const auditRoute = path.resolve(root, "src/app/api/builder/stitch/audit/route.ts");
  assert.ok(
    !fs.existsSync(auditRoute),
    "builder/stitch/audit/route.ts was removed in the route-cap cleanup — if re-added, restore its registration guard",
  );
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
