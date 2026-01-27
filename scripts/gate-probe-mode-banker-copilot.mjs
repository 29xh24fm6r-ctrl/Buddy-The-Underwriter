#!/usr/bin/env node
/**
 * Gate Probe: Banker Copilot Mode (cc Spec — Mode 2)
 *
 * Validates structural wiring for the banker copilot mode:
 *   1. Copilot server routes exist (validate, draft-missing-docs-email)
 *   2. Copilot UI components exist (card, actions, rationale, hook)
 *   3. Mode-gating is enforced in copilot routes
 *   4. Actions call MCP tool handlers
 *   5. Never-500 envelope in route responses
 *   6. Correlation ID generation
 *   7. Signal ledgering for copilot actions
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let pass = 0;
let fail = 0;

function ok(msg) { pass++; console.log(`  PASS: ${msg}`); }
function notOk(msg) { fail++; console.error(`  FAIL: ${msg}`); }

function fileExists(rel) {
  return existsSync(resolve(ROOT, rel));
}

function readFile(rel) {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

console.log("\n=== Gate Probe: Banker Copilot Mode ===\n");

// ── 1. Copilot Server Routes ────────────────────────────

console.log("1) Copilot Server Routes");

const copilotRoutes = [
  { path: "src/app/api/copilot/validate/route.ts", gate: "canValidateCase" },
  { path: "src/app/api/copilot/draft-missing-docs-email/route.ts", gate: "canGenerateDraftEmails" },
];

for (const { path: routePath, gate } of copilotRoutes) {
  if (fileExists(routePath)) {
    ok(`${routePath} exists`);
    const src = readFile(routePath);

    // Mode gating
    if (src.includes(gate)) {
      ok(`${routePath.split("/").pop()} uses ${gate} gate`);
    } else {
      notOk(`${routePath.split("/").pop()} missing ${gate} gate`);
    }

    // Correlation ID
    if (src.includes("generateCorrelationId")) {
      ok(`${routePath.split("/").pop()} generates correlation ID`);
    } else {
      notOk(`${routePath.split("/").pop()} missing correlation ID`);
    }

    // Never-500
    if (src.includes("respond200")) {
      ok(`${routePath.split("/").pop()} uses respond200 (never-500)`);
    } else {
      notOk(`${routePath.split("/").pop()} missing respond200`);
    }

    // POST method
    if (src.includes("export async function POST")) {
      ok(`${routePath.split("/").pop()} exports POST handler`);
    } else {
      notOk(`${routePath.split("/").pop()} missing POST handler`);
    }
  } else {
    notOk(`${routePath} does not exist`);
  }
}

// ── 2. Validate Route Integration ───────────────────────

console.log("\n2) Validate Route Integration");

try {
  const src = readFile("src/app/api/copilot/validate/route.ts");

  if (src.includes("handleValidateCase")) {
    ok("Validate route calls handleValidateCase MCP tool");
  } else {
    notOk("Validate route missing handleValidateCase call");
  }

  const srcLower = src.toLowerCase();
  if (srcLower.includes("ledger") || srcLower.includes("signal") || srcLower.includes("buddy_signal_ledger")) {
    ok("Validate route ledgers action signal");
  } else {
    notOk("Validate route missing signal ledgering");
  }

  if (src.includes("getBuddyMode") || src.includes("canValidateCase")) {
    ok("Validate route checks mode/gate");
  } else {
    notOk("Validate route missing mode check");
  }
} catch (e) {
  notOk(`Validate route read failed: ${e.message}`);
}

// ── 3. Draft Email Route Integration ────────────────────

console.log("\n3) Draft Email Route Integration");

try {
  const src = readFile("src/app/api/copilot/draft-missing-docs-email/route.ts");

  if (src.includes("handleGenerateMissingDocsEmail")) {
    ok("Draft email route calls handleGenerateMissingDocsEmail MCP tool");
  } else {
    notOk("Draft email route missing handleGenerateMissingDocsEmail call");
  }

  const draftLower = src.toLowerCase();
  if (draftLower.includes("ledger") || draftLower.includes("signal") || draftLower.includes("buddy_signal_ledger")) {
    ok("Draft email route ledgers action signal");
  } else {
    notOk("Draft email route missing signal ledgering");
  }
} catch (e) {
  notOk(`Draft email route read failed: ${e.message}`);
}

// ── 4. Copilot UI Components ────────────────────────────

console.log("\n4) Copilot UI Components");

const copilotUI = [
  "src/buddy/copilot/CopilotCard.tsx",
  "src/buddy/copilot/CopilotActions.tsx",
  "src/buddy/copilot/CopilotRationale.tsx",
  "src/buddy/copilot/useCopilotState.ts",
];

for (const file of copilotUI) {
  if (fileExists(file)) {
    ok(`${file} exists`);
  } else {
    notOk(`${file} does not exist`);
  }
}

// ── 5. CopilotCard Structure ────────────────────────────

console.log("\n5) CopilotCard Structure");

try {
  const src = readFile("src/buddy/copilot/CopilotCard.tsx");

  if (src.includes("use client")) {
    ok("CopilotCard is client component");
  } else {
    notOk("CopilotCard missing 'use client'");
  }

  if (src.includes("useCopilotState")) {
    ok("CopilotCard uses useCopilotState hook");
  } else {
    notOk("CopilotCard missing useCopilotState hook");
  }

  if (src.includes("CopilotRationale")) {
    ok("CopilotCard renders CopilotRationale");
  } else {
    notOk("CopilotCard missing CopilotRationale");
  }

  if (src.includes("CopilotActions")) {
    ok("CopilotCard renders CopilotActions");
  } else {
    notOk("CopilotCard missing CopilotActions");
  }

  if (src.includes("omegaAvailable") || src.includes("Omega Unavailable")) {
    ok("CopilotCard handles omega unavailable state");
  } else {
    notOk("CopilotCard missing omega unavailable handling");
  }

  if (src.includes("confidence") && src.includes("recommendation")) {
    ok("CopilotCard displays confidence + recommendation");
  } else {
    notOk("CopilotCard missing confidence/recommendation display");
  }
} catch (e) {
  notOk(`CopilotCard read failed: ${e.message}`);
}

// ── 6. CopilotActions Structure ─────────────────────────

console.log("\n6) CopilotActions Structure");

try {
  const src = readFile("src/buddy/copilot/CopilotActions.tsx");

  if (src.includes("/api/copilot/validate")) {
    ok("CopilotActions calls validate endpoint");
  } else {
    notOk("CopilotActions missing validate endpoint call");
  }

  if (src.includes("/api/copilot/draft-missing-docs-email")) {
    ok("CopilotActions calls draft email endpoint");
  } else {
    notOk("CopilotActions missing draft email endpoint call");
  }

  if (src.includes("canValidate") && src.includes("canDraftEmail")) {
    ok("CopilotActions respects capability props");
  } else {
    notOk("CopilotActions missing capability props");
  }
} catch (e) {
  notOk(`CopilotActions read failed: ${e.message}`);
}

// ── 7. useCopilotState Structure ────────────────────────

console.log("\n7) useCopilotState Structure");

try {
  const src = readFile("src/buddy/copilot/useCopilotState.ts");

  if (src.includes("CopilotConfidence") && src.includes("CopilotState")) {
    ok("useCopilotState exports typed state");
  } else {
    notOk("useCopilotState missing type exports");
  }

  if (src.includes("omegaAvailable")) {
    ok("useCopilotState tracks omega availability");
  } else {
    notOk("useCopilotState missing omega availability");
  }

  if (src.includes("correlationId")) {
    ok("useCopilotState tracks correlation ID");
  } else {
    notOk("useCopilotState missing correlation ID tracking");
  }

  if (src.includes("refresh")) {
    ok("useCopilotState exposes refresh function");
  } else {
    notOk("useCopilotState missing refresh function");
  }
} catch (e) {
  notOk(`useCopilotState read failed: ${e.message}`);
}

// ── Summary ─────────────────────────────────────────────

console.log(`\n=== Banker Copilot Mode: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);
