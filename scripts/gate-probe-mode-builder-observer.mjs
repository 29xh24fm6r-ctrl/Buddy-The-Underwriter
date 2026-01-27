#!/usr/bin/env node
/**
 * Gate Probe: Builder Observer Mode (cc Spec — Mode 1)
 *
 * Validates structural wiring for the builder observer mode:
 *   1. Mode registry resolves builder_observer correctly
 *   2. Gates module exports all 9 gate functions
 *   3. Observer server routes exist (health, events, traces)
 *   4. Observer UI components exist (panel, badges, feed hook)
 *   5. Mode-gating is enforced in observer routes (canViewDiagnostics)
 *   6. Never-500 envelope in route responses
 *   7. Correlation ID generation in all routes
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

console.log("\n=== Gate Probe: Builder Observer Mode ===\n");

// ── 1. Mode Registry ────────────────────────────────────

console.log("1) Mode Registry");

try {
  const src = readFile("src/lib/modes/mode.ts");

  if (src.includes('"builder_observer"') && src.includes('"banker_copilot"') && src.includes('"examiner_portal"')) {
    ok("mode.ts declares all 3 BuddyMode values");
  } else {
    notOk("mode.ts missing BuddyMode values");
  }

  if (src.includes("getBuddyMode")) {
    ok("mode.ts exports getBuddyMode");
  } else {
    notOk("mode.ts missing getBuddyMode");
  }

  if (src.includes("isBuddyMode")) {
    ok("mode.ts exports isBuddyMode");
  } else {
    notOk("mode.ts missing isBuddyMode");
  }

  if (src.includes("NEXT_PUBLIC_BUDDY_MODE")) {
    ok("mode.ts reads NEXT_PUBLIC_BUDDY_MODE env var");
  } else {
    notOk("mode.ts missing env var reference");
  }

  // Builder-specific: dev → builder_observer
  if (src.includes("isDev") && src.includes("builder_observer")) {
    ok("mode.ts: dev environment resolves to builder_observer");
  } else {
    notOk("mode.ts: missing dev → builder_observer resolution");
  }
} catch (e) {
  notOk(`mode.ts read failed: ${e.message}`);
}

// ── 2. Feature Gates ────────────────────────────────────

console.log("\n2) Feature Gates");

try {
  const src = readFile("src/lib/modes/gates.ts");

  const gates = [
    "canViewDiagnostics",
    "canReplayCase",
    "canValidateCase",
    "canGenerateDraftEmails",
    "canDownloadExaminerDrop",
    "canViewCopilotCard",
    "canVerifyIntegrity",
    "canAccessObserverPanel",
    "canAccessExaminerPortal",
  ];

  for (const gate of gates) {
    if (src.includes(`export function ${gate}`)) {
      ok(`gates.ts exports ${gate}`);
    } else {
      notOk(`gates.ts missing ${gate}`);
    }
  }

  if (src.includes("computeGates")) {
    ok("gates.ts exports computeGates aggregate");
  } else {
    notOk("gates.ts missing computeGates");
  }

  // Builder-specific gates: canViewDiagnostics, canReplayCase, canAccessObserverPanel → builder_observer
  if (src.includes('canViewDiagnostics') && src.includes('builder_observer')) {
    ok("canViewDiagnostics checks for builder_observer");
  } else {
    notOk("canViewDiagnostics missing builder_observer check");
  }
} catch (e) {
  notOk(`gates.ts read failed: ${e.message}`);
}

// ── 3. Observer Server Routes ───────────────────────────

console.log("\n3) Observer Server Routes");

const observerRoutes = [
  "src/app/api/buddy/observer/health/route.ts",
  "src/app/api/buddy/observer/events/route.ts",
  "src/app/api/buddy/observer/traces/route.ts",
];

for (const route of observerRoutes) {
  if (fileExists(route)) {
    ok(`${route} exists`);
    const src = readFile(route);

    // Check mode gating
    if (src.includes("canViewDiagnostics")) {
      ok(`${route.split("/").pop()} uses canViewDiagnostics gate`);
    } else {
      notOk(`${route.split("/").pop()} missing canViewDiagnostics gate`);
    }

    // Check correlation ID
    if (src.includes("generateCorrelationId")) {
      ok(`${route.split("/").pop()} generates correlation ID`);
    } else {
      notOk(`${route.split("/").pop()} missing correlation ID`);
    }

    // Check never-500 pattern
    if (src.includes("respond200")) {
      ok(`${route.split("/").pop()} uses respond200 (never-500)`);
    } else {
      notOk(`${route.split("/").pop()} missing respond200`);
    }
  } else {
    notOk(`${route} does not exist`);
  }
}

// ── 4. Observer UI Components ───────────────────────────

console.log("\n4) Observer UI Components");

const observerUI = [
  "src/buddy/observer/ObserverPanel.tsx",
  "src/buddy/observer/ObserverBadges.tsx",
  "src/buddy/observer/useObserverFeed.ts",
];

for (const file of observerUI) {
  if (fileExists(file)) {
    ok(`${file} exists`);
  } else {
    notOk(`${file} does not exist`);
  }
}

try {
  const panelSrc = readFile("src/buddy/observer/ObserverPanel.tsx");
  if (panelSrc.includes("use client")) {
    ok("ObserverPanel.tsx is client component");
  } else {
    notOk("ObserverPanel.tsx missing 'use client'");
  }

  if (panelSrc.includes("useObserverFeed")) {
    ok("ObserverPanel uses useObserverFeed hook");
  } else {
    notOk("ObserverPanel missing useObserverFeed hook");
  }
} catch (e) {
  notOk(`ObserverPanel.tsx read failed: ${e.message}`);
}

try {
  const hookSrc = readFile("src/buddy/observer/useObserverFeed.ts");
  if (hookSrc.includes("/api/buddy/observer/health")) {
    ok("useObserverFeed polls health endpoint");
  } else {
    notOk("useObserverFeed missing health endpoint poll");
  }

  if (hookSrc.includes("/api/buddy/observer/events")) {
    ok("useObserverFeed polls events endpoint");
  } else {
    notOk("useObserverFeed missing events endpoint poll");
  }
} catch (e) {
  notOk(`useObserverFeed.ts read failed: ${e.message}`);
}

// ── 5. Health Route Checks Omega ────────────────────────

console.log("\n5) Health Route Integration");

try {
  const healthSrc = readFile("src/app/api/buddy/observer/health/route.ts");

  if (healthSrc.includes("checkOmegaHealth")) {
    ok("Health route calls checkOmegaHealth");
  } else {
    notOk("Health route missing checkOmegaHealth call");
  }

  if (healthSrc.includes("getRecentDegradedEvents") || healthSrc.includes("degraded")) {
    ok("Health route includes degraded events");
  } else {
    notOk("Health route missing degraded events");
  }
} catch (e) {
  notOk(`Health route read failed: ${e.message}`);
}

// ── Summary ─────────────────────────────────────────────

console.log(`\n=== Builder Observer Mode: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);
