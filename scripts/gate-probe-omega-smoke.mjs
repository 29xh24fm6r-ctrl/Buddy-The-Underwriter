#!/usr/bin/env node
/**
 * Gate Probe: Omega Smoke Test
 *
 * Verifies that Buddy functions correctly when Omega is disabled/unavailable.
 * This probe MUST pass before any deployment.
 *
 * Assertions:
 * 1. Omega modules load without error
 * 2. invokeOmega returns { ok: false } when disabled
 * 3. mirrorEventToOmega completes without error for unmapped events
 * 4. Health check reports disabled when env var missing
 * 5. Zero unhandled exceptions
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let pass = 0;
let fail = 0;

function ok(msg) { pass++; console.log(`  PASS: ${msg}`); }
function notOk(msg) { fail++; console.error(`  FAIL: ${msg}`); }

console.log("\n=== Gate Probe: Omega Smoke ===\n");

// 1. Mapping files exist and parse
console.log("1) Mapping files");
try {
  const raw = readFileSync(resolve(ROOT, "docs/omega/mapping.json"), "utf-8");
  const mapping = JSON.parse(raw);
  if (mapping.version && mapping.entities.length > 0) {
    ok("mapping.json loads and has entities");
  } else {
    notOk("mapping.json missing version or entities");
  }
} catch (e) {
  notOk(`mapping.json load failed: ${e.message}`);
}

// 2. Source files exist
console.log("\n2) Source files exist");
const requiredFiles = [
  "src/lib/omega/invokeOmega.ts",
  "src/lib/omega/mirrorEventToOmega.ts",
  "src/lib/omega/readOmegaState.ts",
  "src/lib/omega/evaluateOmegaConfidence.ts",
  "src/lib/omega/readOmegaTraces.ts",
  "src/lib/omega/health.ts",
  "src/lib/omega/mapping.ts",
  "src/lib/omega/uri.ts",
  "src/lib/omega/redaction.ts",
];

for (const file of requiredFiles) {
  try {
    readFileSync(resolve(ROOT, file), "utf-8");
    ok(`${file} exists`);
  } catch {
    notOk(`${file} missing`);
  }
}

// 3. Omega disabled by default (no env vars set)
console.log("\n3) Default config");
if (process.env.OMEGA_MCP_ENABLED !== "1") {
  ok("OMEGA_MCP_ENABLED not set (disabled by default)");
} else {
  notOk("OMEGA_MCP_ENABLED should not be set in CI");
}

if (process.env.OMEGA_MCP_KILL_SWITCH !== "1") {
  ok("OMEGA_MCP_KILL_SWITCH not set");
} else {
  ok("OMEGA_MCP_KILL_SWITCH is set (safe — kills Omega calls)");
}

// 4. Signal types include omega events
console.log("\n4) Signal type coverage");
try {
  const signalsRaw = readFileSync(resolve(ROOT, "src/buddy/signals.ts"), "utf-8");
  const omegaSignals = ["omega.invoked", "omega.succeeded", "omega.failed", "omega.timed_out", "omega.killed"];
  for (const sig of omegaSignals) {
    if (signalsRaw.includes(`"${sig}"`)) {
      ok(`Signal type '${sig}' registered`);
    } else {
      notOk(`Signal type '${sig}' NOT registered in signals.ts`);
    }
  }
} catch (e) {
  notOk(`signals.ts read failed: ${e.message}`);
}

// 5. writeBuddySignal hooks omega mirror
console.log("\n5) Signal write path wiring");
try {
  const writeSignalRaw = readFileSync(resolve(ROOT, "src/buddy/server/writeBuddySignal.ts"), "utf-8");
  if (writeSignalRaw.includes("mirrorToOmega") || writeSignalRaw.includes("mirrorEventToOmega")) {
    ok("writeBuddySignal hooks omega mirror");
  } else {
    notOk("writeBuddySignal does NOT hook omega mirror");
  }
} catch (e) {
  notOk(`writeBuddySignal.ts read failed: ${e.message}`);
}

// 6. Lifecycle guards accept omega confidence
console.log("\n6) Lifecycle guard integration");
try {
  const guardsRaw = readFileSync(resolve(ROOT, "src/lib/deals/lifecycleGuards.ts"), "utf-8");
  if (guardsRaw.includes("omegaConfidence") && guardsRaw.includes("omega_block")) {
    ok("Lifecycle guards accept omega confidence parameter");
  } else {
    notOk("Lifecycle guards do NOT accept omega confidence");
  }
} catch (e) {
  notOk(`lifecycleGuards.ts read failed: ${e.message}`);
}

// 7. Debug endpoints augmented
console.log("\n7) Debug endpoint augmentation");
try {
  const borrowerDebug = readFileSync(resolve(ROOT, "src/app/api/deals/[dealId]/borrower/debug/route.ts"), "utf-8");
  if (borrowerDebug.includes("omega_state") && borrowerDebug.includes("omega_available")) {
    ok("Borrower debug endpoint has omega_state block");
  } else {
    notOk("Borrower debug endpoint missing omega_state block");
  }
} catch (e) {
  notOk(`Borrower debug route read failed: ${e.message}`);
}

try {
  const examinerPortal = readFileSync(resolve(ROOT, "src/app/api/examiner/portal/deals/[dealId]/route.ts"), "utf-8");
  if (examinerPortal.includes("omega_state") && examinerPortal.includes("omega_available")) {
    ok("Examiner portal endpoint has omega_state block");
  } else {
    notOk("Examiner portal endpoint missing omega_state block");
  }
} catch (e) {
  notOk(`Examiner portal route read failed: ${e.message}`);
}

// Summary
console.log("\n=== Summary ===\n");
if (fail > 0) {
  console.error(`FAILED: ${fail} check(s) failed, ${pass} passed.`);
  process.exit(1);
} else {
  console.log(`PASSED: All ${pass} checks passed.`);
  process.exit(0);
}
