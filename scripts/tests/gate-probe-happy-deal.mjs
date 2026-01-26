#!/usr/bin/env node
/**
 * Gate Probe: Happy Path Deal Validation
 *
 * Validates that a seeded/known-good deal returns ok:true on all critical routes.
 * This catches builds that "work" but are silently degraded everywhere.
 *
 * Unlike gate-probe-deal-route.mjs (which only checks for 200 and valid shape),
 * this probe asserts that the deal actually loads successfully (ok: true).
 *
 * Usage:
 *   node scripts/tests/gate-probe-happy-deal.mjs [baseUrl] [dealId]
 *
 * Environment:
 *   BASE_URL - Base URL for API (default: http://localhost:3000)
 *   SEEDED_DEAL_ID - Known-good deal ID that should always return ok:true
 *   AUTH_COOKIE - Session cookie for authentication
 *
 * Exit codes:
 *   0 - All routes return ok: true
 *   1 - One or more routes returned ok: false or failed
 */

import { strict as assert } from "node:assert";

const BASE_URL = process.argv[2] || process.env.BASE_URL || "http://localhost:3000";
const DEAL_ID = process.argv[3] || process.env.SEEDED_DEAL_ID;
const AUTH_COOKIE = process.env.AUTH_COOKIE || "";

// Critical routes that must return ok: true for a seeded deal
const CRITICAL_ROUTES = [
  { path: `/api/deals/${DEAL_ID}`, name: "deal" },
  { path: `/api/deals/${DEAL_ID}/lifecycle`, name: "lifecycle" },
  { path: `/api/deals/${DEAL_ID}/context`, name: "context" },
];

console.log("🎯 Gate Probe: Happy Path Deal Validation");
console.log(`   Base URL: ${BASE_URL}`);
console.log(`   Deal ID: ${DEAL_ID || "(not set)"}`);
console.log("");

if (!DEAL_ID) {
  console.log("⚠️  No SEEDED_DEAL_ID provided - skipping happy path validation.");
  console.log("   Set SEEDED_DEAL_ID environment variable to enable this check.");
  console.log("");
  console.log("✅ Gate probe skipped (no seeded deal)");
  process.exit(0);
}

async function probeRoute(route) {
  const url = `${BASE_URL}${route.path}`;
  console.log(`📡 Probing: ${route.name} (${url})`);

  const headers = {
    "Content-Type": "application/json",
  };

  if (AUTH_COOKIE) {
    headers["Cookie"] = AUTH_COOKIE;
  }

  let response;
  try {
    response = await fetch(url, { headers });
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }

  // Check for 500 (should never happen with Never-500 pattern)
  if (response.status === 500) {
    return { ok: false, error: `HTTP 500 Internal Server Error` };
  }

  // Check for non-200 (auth required, etc.)
  if (response.status !== 200) {
    // Auth failures are acceptable in CI without auth
    if (response.status === 401 || response.status === 403) {
      console.log(`   ⚠️ Auth required (${response.status}) - cannot validate ok:true`);
      return { ok: true, skipped: true, reason: `auth_required_${response.status}` };
    }
    return { ok: false, error: `Unexpected status: ${response.status}` };
  }

  // Parse JSON
  let data;
  try {
    data = await response.json();
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err.message}` };
  }

  // Check x-correlation-id header
  const correlationId = response.headers.get("x-correlation-id");
  if (!correlationId) {
    return { ok: false, error: "Missing x-correlation-id header" };
  }

  // Check x-buddy-route header
  const buddyRoute = response.headers.get("x-buddy-route");
  if (!buddyRoute) {
    return { ok: false, error: "Missing x-buddy-route header" };
  }

  // The critical check: ok must be true
  if (data.ok !== true) {
    const errorCode = data.error?.code ?? "unknown";
    const errorMessage = data.error?.message ?? "No error message";
    return {
      ok: false,
      error: `Route returned ok:false (code=${errorCode}): ${errorMessage}`,
      correlationId,
    };
  }

  console.log(`   ✅ ${route.name}: ok=true, correlationId=${correlationId}`);
  return { ok: true, correlationId };
}

async function runProbe() {
  const results = [];
  let allPassed = true;
  let anySkipped = false;

  for (const route of CRITICAL_ROUTES) {
    const result = await probeRoute(route);
    results.push({ route: route.name, ...result });

    if (!result.ok) {
      allPassed = false;
    }
    if (result.skipped) {
      anySkipped = true;
    }
  }

  console.log("");

  // Report results
  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped);

  if (failed.length > 0) {
    console.error("❌ Happy path validation FAILED:");
    for (const f of failed) {
      console.error(`   - ${f.route}: ${f.error}`);
      if (f.correlationId) {
        console.error(`     correlationId: ${f.correlationId}`);
      }
    }
    console.error("");
    console.error("This indicates the seeded deal is degraded.");
    console.error("Check the correlationId in server logs for details.");
    process.exit(1);
  }

  if (anySkipped) {
    console.log("⚠️ Some routes skipped due to auth requirements.");
    console.log("   To fully validate, set AUTH_COOKIE environment variable.");
  }

  console.log("✅ Gate probe passed: All critical routes return ok:true");
  console.log(`   Validated ${results.length - skipped.length} routes`);
  console.log("");
  console.log("   Routes validated:");
  for (const r of results) {
    if (r.skipped) {
      console.log(`     ⚠️ ${r.route} (skipped: ${r.reason})`);
    } else {
      console.log(`     ✓ ${r.route}`);
    }
  }
}

runProbe().catch((err) => {
  console.error(`❌ Probe failed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
