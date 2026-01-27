#!/usr/bin/env node
/**
 * Gate Probe: Omega Confidence Gating
 *
 * Verifies that the confidence delegation wiring is structurally correct
 * and that lifecycle guards properly integrate Omega confidence.
 *
 * Assertions:
 * 1. evaluateOmegaConfidence exists and uses invokeOmega
 * 2. Lifecycle guards accept omegaConfidence parameter
 * 3. Lifecycle guards handle "block" recommendation
 * 4. Lifecycle guards work without omegaConfidence (fallback)
 * 5. omega_block reason is defined in type
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

console.log("\n=== Gate Probe: Omega Confidence ===\n");

// 1. evaluateOmegaConfidence structure
console.log("1) Confidence evaluator");
try {
  const src = readFileSync(resolve(ROOT, "src/lib/omega/evaluateOmegaConfidence.ts"), "utf-8");
  if (src.includes("invokeOmega")) {
    ok("evaluateOmegaConfidence uses invokeOmega");
  } else {
    notOk("evaluateOmegaConfidence does NOT use invokeOmega");
  }
  if (src.includes("omega://confidence/evaluate")) {
    ok("evaluateOmegaConfidence calls omega://confidence/evaluate");
  } else {
    notOk("evaluateOmegaConfidence missing confidence/evaluate resource");
  }
  if (src.includes("buddy/underwriting") && src.includes("buddy/model_governance")) {
    ok("evaluateOmegaConfidence sends both constraint namespaces");
  } else {
    notOk("evaluateOmegaConfidence missing constraint namespaces");
  }
} catch (e) {
  notOk(`Cannot read evaluateOmegaConfidence.ts: ${e.message}`);
}

// 2. Lifecycle guard integration
console.log("\n2) Lifecycle guard integration");
try {
  const guardSrc = readFileSync(resolve(ROOT, "src/lib/deals/lifecycleGuards.ts"), "utf-8");

  if (guardSrc.includes("omegaConfidence")) {
    ok("buildUnderwriteStartGate accepts omegaConfidence param");
  } else {
    notOk("buildUnderwriteStartGate missing omegaConfidence param");
  }

  if (guardSrc.includes('"omega_block"')) {
    ok("omega_block reason type defined");
  } else {
    notOk("omega_block reason type NOT defined");
  }

  // Verify fallback behavior: omegaConfidence is optional
  if (guardSrc.includes("omegaConfidence?:") || guardSrc.includes("omegaConfidence?: {")) {
    ok("omegaConfidence is optional (fallback safe)");
  } else {
    notOk("omegaConfidence should be optional for fallback behavior");
  }

  // Verify block recommendation handling
  if (guardSrc.includes('recommendation === "block"')) {
    ok("Guard handles block recommendation");
  } else {
    notOk("Guard does NOT handle block recommendation");
  }

  // Verify omega_confidence is surfaced in gate result
  if (guardSrc.includes("omega_confidence")) {
    ok("Gate result includes omega_confidence field");
  } else {
    notOk("Gate result missing omega_confidence field");
  }
} catch (e) {
  notOk(`Cannot read lifecycleGuards.ts: ${e.message}`);
}

// 3. Mapping includes confidence resource
console.log("\n3) Mapping alignment");
try {
  const mappingRaw = readFileSync(resolve(ROOT, "docs/omega/mapping.json"), "utf-8");
  const mapping = JSON.parse(mappingRaw);

  // Verify constraint namespaces exist
  const namespaces = mapping.constraints.map((c) => c.namespace);
  if (namespaces.includes("buddy/underwriting")) {
    ok("buddy/underwriting constraint namespace mapped");
  } else {
    notOk("buddy/underwriting constraint namespace NOT mapped");
  }
  if (namespaces.includes("buddy/model_governance")) {
    ok("buddy/model_governance constraint namespace mapped");
  } else {
    notOk("buddy/model_governance constraint namespace NOT mapped");
  }
} catch (e) {
  notOk(`Cannot read mapping.json: ${e.message}`);
}

// 4. Health check exists
console.log("\n4) Health check");
try {
  const healthSrc = readFileSync(resolve(ROOT, "src/lib/omega/health.ts"), "utf-8");
  if (healthSrc.includes("checkOmegaHealth")) {
    ok("checkOmegaHealth function exists");
  } else {
    notOk("checkOmegaHealth function missing");
  }
  if (healthSrc.includes("OMEGA_MCP_KILL_SWITCH")) {
    ok("Health check respects kill switch");
  } else {
    notOk("Health check does NOT check kill switch");
  }
} catch (e) {
  notOk(`Cannot read health.ts: ${e.message}`);
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
