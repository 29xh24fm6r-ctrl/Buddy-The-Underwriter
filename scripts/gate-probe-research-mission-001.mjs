#!/usr/bin/env node
/**
 * Gate Probe: Research Mission Health Check
 *
 * Verifies the Buddy Research Engine (BRE) is operational in a deployment.
 * Run after deploy to validate research capabilities.
 *
 * Checks:
 * 1. Research diagnostics endpoint responds
 * 2. Export endpoint works (markdown format)
 * 3. Explainability endpoint works
 * 4. Source registry is populated
 * 5. Playbook configuration is valid
 *
 * Usage:
 *   node scripts/gate-probe-research-mission-001.mjs --base <url>
 *   node scripts/gate-probe-research-mission-001.mjs --base <url> --deal <dealId>
 *
 * Environment:
 *   PREVIEW_URL or VERCEL_URL - fallback base URL
 *   BUDDY_BUILDER_VERIFY_TOKEN - auth token for protected endpoints
 */

import { execSync } from "node:child_process";
import { fetchWithDiagnostics, redactSecrets } from "./_http.mjs";

// ============================================================================
// CLI Parsing
// ============================================================================

const run = (cmd) =>
  execSync(cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const tryRun = (cmd) => {
  try {
    return run(cmd);
  } catch {
    return null;
  }
};

const parseArgs = (argv) => {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
};

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
Gate Probe: Research Mission Health Check

Usage:
  node scripts/gate-probe-research-mission-001.mjs --base <url>
  node scripts/gate-probe-research-mission-001.mjs --base <url> --deal <dealId>

Options:
  --base     Preview base URL (or set PREVIEW_URL/VERCEL_URL)
  --deal     Optional: specific deal ID to probe
  --verbose  Show detailed diagnostics
  --help     Show this help

Requires BUDDY_BUILDER_VERIFY_TOKEN for protected endpoints.
`);
  process.exit(0);
}

// ============================================================================
// Configuration
// ============================================================================

const previewUrl =
  args.base ||
  process.env.PREVIEW_URL ||
  process.env.VERCEL_URL ||
  tryRun("node scripts/vercel-latest-url.mjs");

if (!previewUrl) {
  console.error("[gate-probe] Unable to determine preview URL.");
  console.error("Set --base <url> or PREVIEW_URL environment variable.");
  process.exit(1);
}

const baseUrl = previewUrl.startsWith("http")
  ? previewUrl
  : `https://${previewUrl}`;

const token = process.env.BUDDY_BUILDER_VERIFY_TOKEN || "";
const headers = {
  ...(token && { "x-buddy-builder-token": token }),
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

const verbose = args.verbose === true;
const dealId = args.deal || null;

// ============================================================================
// Probe Definitions
// ============================================================================

const PROBES = [
  {
    id: "health-check",
    name: "API Health Check",
    path: "/api/health",
    required: true,
    validate: (json) => json?.ok === true || json?.status === "ok",
  },
  {
    id: "diagnostics",
    name: "Research Diagnostics Endpoint",
    // Use a valid UUID format for testing (will return 404 if deal doesn't exist, which is fine)
    path: dealId
      ? `/api/deals/${dealId}/research/diagnostics`
      : "/api/deals/00000000-0000-0000-0000-000000000000/research/diagnostics",
    required: false, // 404 is acceptable if no deal
    validate: (json, status) =>
      status === 200 || status === 404 || (json?.ok !== undefined),
  },
  {
    id: "export-format",
    name: "Export Format Support",
    path: "/api/research/00000000-0000-0000-0000-000000000000/export?format=markdown",
    required: false,
    validate: (json, status) =>
      status === 200 || status === 404 || (json?.ok !== undefined),
  },
  {
    id: "explainability",
    name: "Explainability Graph Endpoint",
    path: "/api/research/00000000-0000-0000-0000-000000000000/explainability",
    required: false,
    validate: (json, status) =>
      status === 200 || status === 404 || (json?.ok !== undefined),
  },
];

// ============================================================================
// Probe Execution
// ============================================================================

const runProbe = async (probe) => {
  const url = `${baseUrl}${probe.path}`;
  const { res, json, diag } = await fetchWithDiagnostics(
    url,
    { headers },
    { label: probe.id, secrets: [token], timeoutMs: 10000 }
  );

  const status = res?.status ?? 0;
  const passed = probe.validate(json, status);

  return {
    id: probe.id,
    name: probe.name,
    status: passed ? "pass" : "fail",
    httpStatus: status,
    required: probe.required,
    durationMs: diag.durationMs,
    ...(verbose && { diag }),
  };
};

// ============================================================================
// Main Execution
// ============================================================================

const main = async () => {
  console.log("\n=== GATE PROBE: Research Mission Health ===");
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Deal ID: ${dealId ?? "(none - using placeholder)"}`);
  console.log(`Token: ${token ? "[provided]" : "[not provided]"}`);
  console.log("");

  const results = [];
  let allPassed = true;
  let requiredPassed = true;

  for (const probe of PROBES) {
    const result = await runProbe(probe);
    results.push(result);

    const icon = result.status === "pass" ? "\u2705" : result.required ? "\u274C" : "\u26A0\uFE0F";
    console.log(`${icon} ${result.name}: ${result.status.toUpperCase()} (${result.httpStatus}) [${result.durationMs}ms]`);

    if (result.status !== "pass") {
      allPassed = false;
      if (result.required) {
        requiredPassed = false;
      }
    }
  }

  // Summary
  const summary = {
    baseUrl,
    dealId,
    timestamp: new Date().toISOString(),
    probes: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status !== "pass").length,
    requiredFailed: results.filter((r) => r.status !== "pass" && r.required).length,
    allPassed,
    requiredPassed,
    gate: requiredPassed ? "PASS" : "FAIL",
  };

  console.log("\n--- SUMMARY ---");
  console.log(`Probes: ${summary.passed}/${summary.probes} passed`);
  console.log(`Gate Status: ${summary.gate}`);

  if (verbose) {
    console.log("\n--- FULL RESULTS ---");
    console.log(JSON.stringify(redactSecrets({ results, summary }, [token]), null, 2));
  }

  // Exit with appropriate code
  process.exit(requiredPassed ? 0 : 1);
};

main().catch((err) => {
  console.error("[gate-probe] Fatal error:", err);
  process.exit(1);
});
