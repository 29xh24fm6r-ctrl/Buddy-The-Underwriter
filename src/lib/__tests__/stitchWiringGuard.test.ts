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
    const regRoute = registryMap.get(entry.key as typeof STITCH_SURFACES[number]["key"]);
    if (regRoute && regRoute !== entry.route) {
      mismatches.push(`${entry.key}: ledger=${entry.route} registry=${regRoute}`);
    }
  }
  assert.equal(mismatches.length, 0, `Route mismatches:\n${mismatches.join("\n")}`);
});

// ── Guard 3: No required surface is left with old status ──
test("no required surface uses deprecated status values", () => {
  const deprecated = ["wired", "visual", "partial", "broken", "unverified"];
  const violations = SURFACE_WIRING_LEDGER.filter(
    (e) => e.required && deprecated.includes(e.status as string),
  );
  assert.equal(
    violations.length,
    0,
    `Surfaces with deprecated status: ${violations.map((e) => `${e.key}=${e.status}`).join(", ")}`,
  );
});

// ── Guard 4: P0 surfaces are no longer visual_static ──────
test("P0 surfaces are not visual_static", () => {
  const p0Keys = [
    "credit_committee_view",
    "exceptions_change_review",
    "deals_command_bridge",
    "borrower_task_inbox",
    "borrower_control_record",
    "pricing_memo_command_center",
  ];
  const visual = SURFACE_WIRING_LEDGER.filter(
    (e) => p0Keys.includes(e.key) && e.status === "visual_static",
  );
  assert.equal(
    visual.length,
    0,
    `P0 surfaces still visual_static: ${visual.map((e) => e.key).join(", ")}`,
  );
});

// ── Guard 5: Wired surfaces have activation scripts ───────
test("wired surfaces have activation scripts", () => {
  const wiredStatuses = ["wired_readonly", "wired_interactive"];
  const wiredNoScript = SURFACE_WIRING_LEDGER.filter(
    (e) => wiredStatuses.includes(e.status) && !e.hasActivationScript,
  );
  assert.equal(
    wiredNoScript.length,
    0,
    `Surfaces marked wired but missing activation script: ${wiredNoScript.map((e) => e.key).join(", ")}`,
  );
});

// ── Guard 6: Blocked surfaces have honest classification ──
test("blocked surfaces are not marked wired", () => {
  const blockedStatuses = ["blocked_missing_backend", "blocked_auth", "blocked_missing_data_contract"];
  const blockedButWired = SURFACE_WIRING_LEDGER.filter(
    (e) => blockedStatuses.includes(e.status) && e.hasActivationScript,
  );
  assert.equal(
    blockedButWired.length,
    0,
    `Blocked surfaces claiming activation: ${blockedButWired.map((e) => e.key).join(", ")}`,
  );
});

// ── Guard 7: Summary counts are consistent ────────────────
test("wiring summary counts are consistent", () => {
  const summary = getWiringSummary();
  const statusSum =
    summary.recovery_optional +
    summary.visual_static +
    summary.partial_readonly +
    summary.partial_interactive +
    summary.wired_readonly +
    summary.wired_interactive +
    summary.blocked_auth +
    summary.blocked_missing_backend +
    summary.blocked_missing_data_contract +
    summary.retired;
  assert.equal(statusSum, summary.total, "Status counts don't sum to total");
});

// ── Guard 8: SWR hooks handle 403 ────────────────────────
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

  assert.equal(missing.length, 0, `SWR hooks missing shouldRetryOnError: ${missing.join(", ")}`);
});

// ── Guard 9: Activation scripts exist for wired surfaces ──
test("activation script files exist for all wired surfaces", () => {
  const activationDir = path.resolve(root, "src/lib/stitch/activations");
  const wiredStatuses = ["wired_readonly", "wired_interactive"];
  const wired = SURFACE_WIRING_LEDGER.filter((e) => wiredStatuses.includes(e.status));

  // Each wired surface should have its activation slug handled in StitchRouteBridge
  const bridgePath = path.resolve(root, "src/components/stitch/StitchRouteBridge.tsx");
  const bridgeContent = fs.readFileSync(bridgePath, "utf8");

  const missing: string[] = [];
  for (const entry of wired) {
    if (!bridgeContent.includes(`"${entry.slug}"`)) {
      missing.push(`${entry.key} (slug: ${entry.slug})`);
    }
  }

  assert.equal(missing.length, 0, `Wired surfaces not handled in StitchRouteBridge: ${missing.join(", ")}`);
});

// ── Guard 10: Every activationMode is valid ───────────────
test("every surface has valid activationMode", () => {
  const validModes = ["none", "overlay", "replace"];
  const invalid = SURFACE_WIRING_LEDGER.filter((e) => !validModes.includes(e.activationMode));
  assert.equal(invalid.length, 0, `Invalid activationMode: ${invalid.map((e) => `${e.key}=${e.activationMode}`).join(", ")}`);
});

// ── Guard 11: Workout surfaces are honestly blocked ───────
test("workout surfaces are classified as blocked_missing_backend", () => {
  const workoutKeys = [
    "workout_command_center",
    "workout_case_file",
    "workout_committee_packet",
    "workout_legal_execution_tracker",
    "reo_command_center",
    "chargeoff_recovery_command_center",
  ];
  const notBlocked = SURFACE_WIRING_LEDGER.filter(
    (e) => workoutKeys.includes(e.key) && e.status !== "blocked_missing_backend",
  );
  assert.equal(
    notBlocked.length,
    0,
    `Workout surfaces not honestly blocked: ${notBlocked.map((e) => `${e.key}=${e.status}`).join(", ")}`,
  );
});

// ── Guard 12: No fake API endpoints in activation code ────
test("no activation scripts reference fake API endpoints", () => {
  const activationDir = path.resolve(root, "src/lib/stitch/activations");
  if (!fs.existsSync(activationDir)) return;

  const fakePatterns = ["/api/fake", "/api/mock", "borrowers/test-id", "test-id"];
  const violations: string[] = [];

  const files = fs.readdirSync(activationDir);
  for (const file of files) {
    if (!file.endsWith(".ts")) continue;
    const content = fs.readFileSync(path.join(activationDir, file), "utf8");
    for (const pattern of fakePatterns) {
      if (content.includes(pattern)) {
        violations.push(`${file}: contains "${pattern}"`);
      }
    }
  }

  assert.equal(violations.length, 0, `Fake API refs in activation code:\n${violations.join("\n")}`);
});
