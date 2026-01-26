#!/usr/bin/env node
/**
 * Manifest-Driven Never-500 Pattern Validator
 *
 * Reads from scripts/critical-routes.manifest.json and validates that all
 * critical routes follow the Never-500 contract:
 * - Always HTTP 200
 * - Always x-correlation-id header
 * - Always x-buddy-route header
 * - Valid JSON with 'ok' field
 *
 * Usage:
 *   node scripts/check-never-500.mjs [--live]
 *
 * Options:
 *   --live    Run live HTTP checks against BASE URL (requires BASE and DEAL_ID env vars)
 *   (default) Run static file checks only
 *
 * Environment:
 *   BASE      Base URL for live checks (e.g., https://buddy-the-underwriter.vercel.app)
 *   DEAL_ID   Deal ID to use in path substitution
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, "critical-routes.manifest.json");

// ANSI colors
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function loadManifest() {
  const raw = fs.readFileSync(MANIFEST_PATH, "utf-8");
  return JSON.parse(raw);
}

// Patterns that indicate Never-500 compliance in source code
const COMPLIANCE_PATTERNS = [
  "respond200",           // Uses shared envelope helper
  "createJsonResponse",   // Uses local JSON response helper
  "status: 200",          // Explicitly returns 200
  "jsonSafe",             // Uses JSON-safe serialization
];

// Patterns that indicate correlation ID usage
const CORRELATION_PATTERNS = [
  "correlationId",
  "x-correlation-id",
  "makeCorrelationId",
  "generateCorrelationId",
];

// Patterns that indicate route identity header
const ROUTE_IDENTITY_PATTERNS = [
  "x-buddy-route",
  "createHeaders",
  "ROUTE",
];

/**
 * Static check: Verify source file follows Never-500 pattern
 */
function checkSourceFile(route) {
  const errors = [];
  const filePath = route.sourceFile;

  if (!fs.existsSync(filePath)) {
    return { ok: false, errors: [`File not found: ${filePath}`] };
  }

  const content = fs.readFileSync(filePath, "utf-8");

  // Check for compliance pattern
  const hasCompliance = COMPLIANCE_PATTERNS.some((p) => content.includes(p));
  if (!hasCompliance) {
    errors.push("Missing Never-500 compliance pattern (respond200/createJsonResponse/status:200/jsonSafe)");
  }

  // Check for correlation ID
  const hasCorrelation = CORRELATION_PATTERNS.some((p) => content.includes(p));
  if (!hasCorrelation) {
    errors.push("Missing correlation ID pattern");
  }

  // Check for route identity
  const hasRouteIdentity = ROUTE_IDENTITY_PATTERNS.some((p) => content.includes(p));
  if (!hasRouteIdentity) {
    errors.push("Missing route identity pattern (x-buddy-route)");
  }

  // Check for try-catch
  const hasCatch = /catch.*err|} catch/.test(content);
  if (!hasCatch) {
    errors.push("Missing ultimate catch block");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Live check: Verify route returns correct response
 */
async function checkLiveRoute(route, baseUrl, dealId) {
  const url = `${baseUrl}${route.path.replace("{dealId}", dealId)}`;
  const errors = [];

  try {
    const fetchOptions = { method: route.method };
    if (route.method === "POST") {
      fetchOptions.headers = { "Content-Type": "application/json" };
      fetchOptions.body = "{}";
    }

    const res = await fetch(url, fetchOptions);
    const correlationId = res.headers.get("x-correlation-id");
    const buddyRoute = res.headers.get("x-buddy-route");

    // Check HTTP status
    if (res.status !== 200) {
      errors.push(`HTTP ${res.status} (expected 200)`);
    }

    // Check correlation ID
    if (!correlationId) {
      errors.push("Missing x-correlation-id header");
    } else if (route.correlationPrefix && !correlationId.startsWith(route.correlationPrefix)) {
      errors.push(`x-correlation-id '${correlationId}' doesn't start with '${route.correlationPrefix}'`);
    }

    // Check buddy route
    if (!buddyRoute) {
      errors.push("Missing x-buddy-route header");
    } else if (!buddyRoute.includes(route.routeHeader.replace("/api/deals/[dealId]", ""))) {
      errors.push(`x-buddy-route '${buddyRoute}' doesn't match expected '${route.routeHeader}'`);
    }

    // Check JSON response
    let body;
    try {
      body = await res.json();
    } catch (e) {
      errors.push("Response is not valid JSON");
      return { ok: false, errors, url, status: res.status };
    }

    // Check 'ok' field
    if (typeof body.ok !== "boolean") {
      errors.push("Response missing 'ok' boolean field");
    }

    return {
      ok: errors.length === 0,
      errors,
      url,
      status: res.status,
      correlationId,
      buddyRoute,
      responseOk: body?.ok,
    };
  } catch (err) {
    return { ok: false, errors: [`Fetch failed: ${err.message}`], url };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isLive = args.includes("--live");

  console.log("===============================================");
  console.log(" Never-500 Pattern Validator (Manifest-Driven)");
  console.log("===============================================");
  console.log("");

  const manifest = loadManifest();
  console.log(`Manifest version: ${manifest.version}`);
  console.log(`Routes defined: ${manifest.routes.length}`);
  console.log(`Mode: ${isLive ? "LIVE HTTP checks" : "Static file checks"}`);
  console.log("");

  let failures = 0;
  let passes = 0;

  // Static checks (always run)
  console.log("--- Static Source File Checks ---");
  for (const route of manifest.routes) {
    const result = checkSourceFile(route);
    if (result.ok) {
      console.log(`${GREEN}  ✓${RESET} ${route.name} (${route.sourceFile})`);
      passes++;
    } else {
      console.log(`${RED}  ✗${RESET} ${route.name} (${route.sourceFile})`);
      for (const err of result.errors) {
        console.log(`      - ${err}`);
      }
      failures++;
    }
  }
  console.log("");

  // Live checks (if --live flag)
  if (isLive) {
    const baseUrl = process.env.BASE || process.env.APP_URL;
    const dealId = process.env.DEAL_ID || process.env.SEEDED_DEAL_ID || "00000000-0000-0000-0000-000000000000";

    if (!baseUrl) {
      console.log(`${RED}ERROR:${RESET} --live requires BASE or APP_URL environment variable`);
      process.exit(1);
    }

    console.log("--- Live HTTP Checks ---");
    console.log(`Base URL: ${baseUrl}`);
    console.log(`Deal ID: ${dealId}`);
    console.log("");

    for (const route of manifest.routes) {
      const result = await checkLiveRoute(route, baseUrl, dealId);
      if (result.ok) {
        console.log(`${GREEN}  ✓${RESET} ${route.name} ${route.method} ${result.url}`);
        console.log(`      HTTP ${result.status} | corr: ${result.correlationId?.slice(0, 15)}... | route: ✓`);
      } else {
        console.log(`${RED}  ✗${RESET} ${route.name} ${route.method} ${result.url}`);
        for (const err of result.errors) {
          console.log(`      - ${err}`);
        }
        failures++;
      }
    }
    console.log("");
  }

  // Summary
  console.log("===============================================");
  if (failures > 0) {
    console.log(`${RED}FAILED:${RESET} ${failures} check(s) failed`);
    console.log("");
    console.log("Critical routes MUST:");
    console.log("  1. Use respond200() or createJsonResponse() (never throw/500)");
    console.log("  2. Include correlationId in response + x-correlation-id header");
    console.log("  3. Include x-buddy-route header");
    console.log("  4. Have an ultimate catch block for unexpected errors");
    console.log("  5. Use jsonSafe() to prevent serialization crashes");
    console.log("");
    console.log("See src/lib/api/respond.ts for the standard pattern.");
    process.exit(1);
  } else {
    console.log(`${GREEN}PASSED:${RESET} All ${manifest.routes.length} critical routes follow Never-500 pattern`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`${RED}FATAL:${RESET} ${err.message}`);
  process.exit(1);
});
