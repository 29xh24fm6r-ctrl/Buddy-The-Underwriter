import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SURFACE_WIRING_LEDGER, getWiringSummary } from "@/stitch/surface_wiring_ledger";
import { STITCH_SURFACES } from "@/stitch/stitchSurfaceRegistry";

const root = process.cwd();

// ── Guard 1: Ledger covers all registry surfaces ──────────
test("wiring ledger covers every registered surface", () => {
  const ledgerKeys = new Set(SURFACE_WIRING_LEDGER.map((e) => e.key));
  const registryKeys = STITCH_SURFACES.map((s) => s.key);
  const missing = registryKeys.filter((k) => !ledgerKeys.has(k));
  assert.equal(missing.length, 0, `Registry surfaces missing from wiring ledger: ${missing.join(", ")}`);
});

// ── Guard 2: Every ledger entry matches registry route ────
test("wiring ledger routes match registry routes", () => {
  const registryMap = new Map(STITCH_SURFACES.map((s) => [s.key, s.route]));
  const mismatches: string[] = [];
  for (const entry of SURFACE_WIRING_LEDGER) {
    const regRoute = registryMap.get(entry.key);
    if (regRoute && regRoute !== entry.route) {
      mismatches.push(`${entry.key}: ledger=${entry.route} registry=${regRoute}`);
    }
  }
  assert.equal(mismatches.length, 0, `Route mismatches:\n${mismatches.join("\n")}`);
});

// ── Guard 3: No required surface is unverified ────────────
test("no required surface is unverified", () => {
  const unverified = SURFACE_WIRING_LEDGER.filter(
    (e) => e.required && e.status === "unverified",
  );
  assert.equal(
    unverified.length,
    0,
    `Unverified required surfaces: ${unverified.map((e) => e.key).join(", ")}`,
  );
});

// ── Guard 4: No required surface is broken ────────────────
test("no required surface is broken", () => {
  const broken = SURFACE_WIRING_LEDGER.filter(
    (e) => e.required && e.status === "broken",
  );
  assert.equal(
    broken.length,
    0,
    `Broken required surfaces: ${broken.map((e) => e.key).join(", ")}`,
  );
});

// ── Guard 5: Wired surfaces have activation scripts ───────
test("wired surfaces have activation scripts", () => {
  const wiredNoScript = SURFACE_WIRING_LEDGER.filter(
    (e) => e.status === "wired" && !e.hasActivationScript,
  );
  assert.equal(
    wiredNoScript.length,
    0,
    `Surfaces marked 'wired' but missing activation script: ${wiredNoScript.map((e) => e.key).join(", ")}`,
  );
});

// ── Guard 6: Summary counts are consistent ────────────────
test("wiring summary counts are consistent", () => {
  const summary = getWiringSummary();
  assert.equal(
    summary.wired + summary.visual + summary.partial + summary.broken + summary.unverified,
    summary.total,
    "Status counts don't sum to total",
  );
});

// ── Guard 7: SWR hooks handle 403 without throwing ───────
test("all vulnerable SWR hooks have shouldRetryOnError: false", () => {
  const hooksToCheck = [
    "src/hooks/useFinancialSnapshot.ts",
    "src/hooks/useLenderMatches.ts",
    "src/hooks/useFinancialSnapshotDecision.ts",
    "src/components/committee/CommitteePanel.tsx",
    "src/components/deals/UploadStatusCard.tsx",
    "src/components/deals/EnhancedChecklistCard.tsx",
    "src/components/deals/cockpit/hooks/useChecklistDetail.ts",
  ];

  const missing: string[] = [];
  for (const hookPath of hooksToCheck) {
    const absolute = path.resolve(root, hookPath);
    if (!fs.existsSync(absolute)) continue;
    const content = fs.readFileSync(absolute, "utf8");
    if (content.includes("useSWR") && !content.includes("shouldRetryOnError")) {
      missing.push(hookPath);
    }
  }

  assert.equal(
    missing.length,
    0,
    `SWR hooks missing shouldRetryOnError: ${missing.join(", ")}`,
  );
});

// ── Guard 8: SWR hooks handle 403 status code ────────────
test("all SWR fetchers handle 403 status code", () => {
  const fetcherFiles = [
    "src/hooks/useFinancialSnapshot.ts",
    "src/hooks/useLenderMatches.ts",
    "src/hooks/useFinancialSnapshotDecision.ts",
    "src/components/committee/CommitteePanel.tsx",
    "src/components/deals/UploadStatusCard.tsx",
    "src/components/deals/EnhancedChecklistCard.tsx",
    "src/components/deals/cockpit/hooks/useChecklistDetail.ts",
  ];

  const missing: string[] = [];
  for (const filePath of fetcherFiles) {
    const absolute = path.resolve(root, filePath);
    if (!fs.existsSync(absolute)) continue;
    const content = fs.readFileSync(absolute, "utf8");
    if (content.includes("useSWR") && !content.includes("403")) {
      missing.push(filePath);
    }
  }

  assert.equal(
    missing.length,
    0,
    `SWR fetchers not handling 403: ${missing.join(", ")}`,
  );
});

// ── Guard 9: No stitch export contains test-id patterns ──
test("no stitch export calls fake API endpoints", () => {
  const exportsDir = path.join(root, "stitch_exports");
  if (!fs.existsSync(exportsDir)) return;

  const fakePatterns = ["borrowers/test-id", "deals/test-id", "/api/fake", "/api/mock"];
  const violations: string[] = [];

  const dirs = fs.readdirSync(exportsDir, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const htmlPath = path.join(exportsDir, dir.name, "code.html");
    if (!fs.existsSync(htmlPath)) continue;
    const content = fs.readFileSync(htmlPath, "utf8");
    for (const pattern of fakePatterns) {
      if (content.includes(pattern)) {
        violations.push(`${dir.name}: contains "${pattern}"`);
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    `Stitch exports with fake API calls:\n${violations.join("\n")}`,
  );
});

// ── Guard 10: Wiring ledger file exists and exports correctly ──
test("surface_wiring_ledger exports required functions", () => {
  assert.ok(SURFACE_WIRING_LEDGER.length >= 32, `Expected 32+ entries, got ${SURFACE_WIRING_LEDGER.length}`);
  const summary = getWiringSummary();
  assert.ok(summary.total >= 32, `Expected 32+ total, got ${summary.total}`);
  assert.ok(summary.required >= 29, `Expected 29+ required, got ${summary.required}`);
});
