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

// ========================================
// SEAL LINT: Static Pattern Checks
// ========================================

// Required patterns (at least one must be present)
const SEAL_PATTERNS = {
  responder: {
    patterns: ["respond200", "createJsonResponse"],
    error: 'Missing sealed responder (respond200 or createJsonResponse)',
    fix: 'Use respond200() from @/lib/api/respond or define createJsonResponse()',
  },
  correlationId: {
    patterns: ["correlationId", "generateCorrelationId", "makeCorrelationId"],
    error: 'Missing correlation ID generation',
    fix: 'Add: const correlationId = generateCorrelationId("prefix");',
  },
  routeIdentity: {
    patterns: ["x-buddy-route", 'ROUTE =', 'ROUTE='],
    error: 'Missing route identity (x-buddy-route header)',
    fix: 'Add: const ROUTE = "/api/deals/[dealId]/..."; and include in headers',
  },
  catchBlock: {
    patterns: [/} catch\s*\(/],
    error: 'Missing ultimate catch block',
    fix: 'Wrap handler body in try/catch to prevent uncaught exceptions',
    isRegex: true,
  },
  runtimeNodejs: {
    patterns: ['runtime = "nodejs"', "runtime = 'nodejs'"],
    error: 'Missing runtime = "nodejs" export',
    fix: 'Add: export const runtime = "nodejs";',
  },
  dynamicForce: {
    patterns: ['dynamic = "force-dynamic"', "dynamic = 'force-dynamic'"],
    error: 'Missing dynamic = "force-dynamic" export',
    fix: 'Add: export const dynamic = "force-dynamic";',
  },
};

// Forbidden patterns (must NOT be present in handler body)
const FORBIDDEN_PATTERNS = {
  directNextResponse: {
    // Match NextResponse.json that's NOT inside a createJsonResponse function
    // This is a heuristic - we check if NextResponse.json appears outside the helper
    test: (content) => {
      // Count occurrences of NextResponse.json
      const matches = content.match(/NextResponse\.json\s*\(/g) || [];
      // If there's a createJsonResponse function, allow one usage inside it
      const hasHelper = content.includes('function createJsonResponse');
      // If using respond200 from import, no direct usage should exist
      const usesRespond200 = content.includes('respond200');

      if (usesRespond200) {
        // Should have zero NextResponse.json calls
        return matches.length > 0;
      }
      if (hasHelper) {
        // Allow up to 2 usages (success + error fallback inside helper)
        return matches.length > 2;
      }
      // No helper, no respond200 - this is wrong
      return matches.length > 0;
    },
    error: 'Direct NextResponse.json usage outside sealed helper',
    fix: 'Use respond200() or wrap all responses in createJsonResponse()',
  },
};

/**
 * Check if content contains any of the patterns
 */
function hasPattern(content, patterns, isRegex = false) {
  return patterns.some((p) => {
    if (isRegex || p instanceof RegExp) {
      return p.test ? p.test(content) : new RegExp(p).test(content);
    }
    return content.includes(p);
  });
}

/**
 * Static check: Verify source file follows Never-500 seal contract
 */
function checkSourceFile(route) {
  const errors = [];
  const filePath = route.sourceFile;

  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      errors: [{
        message: `File not found: ${filePath}`,
        fix: 'Create the route file or update manifest',
      }],
    };
  }

  const content = fs.readFileSync(filePath, "utf-8");

  // Check required patterns
  for (const [key, check] of Object.entries(SEAL_PATTERNS)) {
    if (!hasPattern(content, check.patterns, check.isRegex)) {
      errors.push({ message: check.error, fix: check.fix });
    }
  }

  // Check forbidden patterns
  for (const [key, check] of Object.entries(FORBIDDEN_PATTERNS)) {
    if (check.test(content)) {
      errors.push({ message: check.error, fix: check.fix });
    }
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
  console.log("--- Static Seal Lint Checks ---");
  for (const route of manifest.routes) {
    const result = checkSourceFile(route);
    if (result.ok) {
      console.log(`${GREEN}  ✓${RESET} ${route.name} (${route.sourceFile})`);
      passes++;
    } else {
      console.log(`${RED}  ✗${RESET} ${route.name} (${route.sourceFile})`);
      for (const err of result.errors) {
        const msg = typeof err === 'string' ? err : err.message;
        const fix = typeof err === 'object' && err.fix ? err.fix : null;
        console.log(`      ${RED}✗${RESET} ${msg}`);
        if (fix) {
          console.log(`        ${YELLOW}→ Fix:${RESET} ${fix}`);
        }
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
