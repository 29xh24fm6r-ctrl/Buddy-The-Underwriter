import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { STITCH_SURFACES } from "@/stitch/stitchSurfaceRegistry";

const root = process.cwd();

// Patterns that indicate a route is still rendering native UI instead of StitchSurface
const NATIVE_FALLBACK_PATTERNS = [
  "listDealsForBank",
  "GlassShell",
  "GlassPageHeader",
  "RolesAdminClient",
  "CanonicalFieldsAdminClient",
  "AuditLedgerClient",
  "CreditCommitteeClient",
  "DealCockpitClient",
  "DealPortalInboxClient",
  "UploadInboxCard",
  "PricingMemoCommandCenterClient",
  "DealMemoTemplateClient",
];

// Pre-existing surfaces that intentionally mix native + Stitch (keep as-is)
const MIXED_MODE_SURFACES = new Set([
  "deal_command",       // panel mode inside native deal shell
  "underwrite",         // native lifecycle guards + Stitch embed
  "credit_committee",   // native layout + Stitch embed
  "borrower_portal",    // native token validation + Stitch embed
  "portfolio",          // native analytics dashboard + Stitch embed
  "deal_intake",        // native intake flow + Stitch embed
]);

// ── Guard 1: No required restored route still renders native fallback ──
test("no required restored route still renders native fallback UI", () => {
  const required = STITCH_SURFACES.filter((s) => s.required && !MIXED_MODE_SURFACES.has(s.key));
  const failures: string[] = [];

  for (const surface of required) {
    if (!surface.pagePath) continue;
    const absolute = path.resolve(root, surface.pagePath);
    if (!fs.existsSync(absolute)) continue;

    const content = fs.readFileSync(absolute, "utf8");

    // Must contain StitchSurface
    if (!content.includes("StitchSurface")) {
      failures.push(`${surface.key} (${surface.pagePath}) does not import StitchSurface`);
      continue;
    }

    // Must NOT contain native fallback patterns
    for (const pattern of NATIVE_FALLBACK_PATTERNS) {
      if (content.includes(pattern)) {
        failures.push(`${surface.key} (${surface.pagePath}) still contains native pattern: ${pattern}`);
      }
    }
  }

  assert.equal(failures.length, 0, `Native fallback detected:\n${failures.join("\n")}`);
});

// ── Guard 2: Every required surface page uses correct surfaceKey ──
test("every required surface page references the correct surfaceKey", () => {
  const required = STITCH_SURFACES.filter((s) => s.required);
  const mismatches: string[] = [];

  for (const surface of required) {
    if (!surface.pagePath) continue;
    const absolute = path.resolve(root, surface.pagePath);
    if (!fs.existsSync(absolute)) continue;

    const content = fs.readFileSync(absolute, "utf8");
    if (!content.includes("StitchSurface")) continue;

    // Check that the surfaceKey in the page matches the registry key
    if (!content.includes(`"${surface.key}"`)) {
      mismatches.push(`${surface.key} (${surface.pagePath}) does not reference surfaceKey="${surface.key}"`);
    }
  }

  assert.equal(mismatches.length, 0, `SurfaceKey mismatches:\n${mismatches.join("\n")}`);
});

// ── Guard 3: StitchSurface wrapper includes DOM markers ──
test("StitchSurface wrapper includes data-stitch-surface marker", () => {
  const surfacePath = path.resolve(root, "src/stitch/StitchSurface.tsx");
  const content = fs.readFileSync(surfacePath, "utf8");

  assert.ok(
    content.includes('data-stitch-surface="true"'),
    "StitchSurface.tsx must include data-stitch-surface=\"true\" DOM marker",
  );
  assert.ok(
    content.includes("data-stitch-key="),
    "StitchSurface.tsx must include data-stitch-key DOM marker",
  );
  assert.ok(
    content.includes("data-stitch-mode="),
    "StitchSurface.tsx must include data-stitch-mode DOM marker",
  );
  assert.ok(
    content.includes("data-stitch-slug="),
    "StitchSurface.tsx must include data-stitch-slug DOM marker",
  );
});

// ── Guard 4: StitchRouteBridge does not silently show generic placeholder ──
test("StitchRouteBridge shows hard failure, not silent placeholder", () => {
  const bridgePath = path.resolve(root, "src/components/stitch/StitchRouteBridge.tsx");
  const content = fs.readFileSync(bridgePath, "utf8");

  // Must NOT contain the old silent fallback
  assert.ok(
    !content.includes("This surface is not yet available"),
    "StitchRouteBridge must not contain the old silent fallback message",
  );

  // Must contain the hard failure indicator
  assert.ok(
    content.includes("data-stitch-bridge-error"),
    "StitchRouteBridge must include data-stitch-bridge-error marker on failure",
  );
  assert.ok(
    content.includes("Required Stitch surface missing"),
    "StitchRouteBridge must show explicit failure message",
  );
});

// ── Guard 5: Stitch exports included in outputFileTracingIncludes ──
test("next.config.mjs includes stitch_exports in tracing for page routes", () => {
  const configPath = path.resolve(root, "next.config.mjs");
  const content = fs.readFileSync(configPath, "utf8");

  assert.ok(
    content.includes("stitch_exports/**/code.html"),
    "next.config.mjs must include stitch_exports/**/code.html in outputFileTracingIncludes",
  );

  // Verify at least some page routes are covered
  assert.ok(
    content.includes('"/analytics"'),
    "next.config.mjs must include /analytics in tracing routes",
  );
  assert.ok(
    content.includes('"/servicing"'),
    "next.config.mjs must include /servicing in tracing routes",
  );
});

// ── Guard 6: SWR hooks handle 403 without throwing ──
test("useFinancialSnapshot handles 403 without throwing", () => {
  const hookPath = path.resolve(root, "src/hooks/useFinancialSnapshot.ts");
  const content = fs.readFileSync(hookPath, "utf8");

  assert.ok(
    content.includes("403"),
    "useFinancialSnapshot must handle 403 status code",
  );
  assert.ok(
    content.includes("shouldRetryOnError"),
    "useFinancialSnapshot must disable SWR retry on auth errors",
  );
});

test("useLenderMatches handles 403 without throwing", () => {
  const hookPath = path.resolve(root, "src/hooks/useLenderMatches.ts");
  const content = fs.readFileSync(hookPath, "utf8");

  assert.ok(
    content.includes("403"),
    "useLenderMatches must handle 403 status code",
  );
  assert.ok(
    content.includes("shouldRetryOnError"),
    "useLenderMatches must disable SWR retry on auth errors",
  );
});
