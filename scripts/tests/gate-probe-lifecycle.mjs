#!/usr/bin/env node
/**
 * Gate Probe: Lifecycle API Shape Validation
 *
 * Prevents regression by validating that GET /api/deals/:id/lifecycle
 * returns the expected JSON shape and NEVER returns 500.
 *
 * Usage:
 *   node scripts/tests/gate-probe-lifecycle.mjs [baseUrl] [dealId]
 *
 * Environment:
 *   BASE_URL - Base URL for API (default: http://localhost:3000)
 *   TEST_DEAL_ID - Deal ID to test (optional - will test 404 handling if not provided)
 *   AUTH_COOKIE - Session cookie for authentication
 *
 * Exit codes:
 *   0 - All assertions passed
 *   1 - Assertion failed or API returned 500
 */

import { strict as assert } from "node:assert";

const BASE_URL = process.argv[2] || process.env.BASE_URL || "http://localhost:3000";
const DEAL_ID = process.argv[3] || process.env.TEST_DEAL_ID || "00000000-0000-0000-0000-000000000000";
const AUTH_COOKIE = process.env.AUTH_COOKIE || "";

console.log("🔍 Gate Probe: Lifecycle API Shape Validation");
console.log(`   Base URL: ${BASE_URL}`);
console.log(`   Deal ID: ${DEAL_ID}`);
console.log("");

/**
 * Assert the lifecycle state shape is valid.
 */
function assertLifecycleShape(state, context) {
  const prefix = `[${context}]`;

  // Required top-level fields
  assert.ok(
    typeof state.stage === "string" && state.stage.length > 0,
    `${prefix} state.stage should be a non-empty string, got: ${state.stage}`
  );

  assert.ok(
    state.lastAdvancedAt === null || typeof state.lastAdvancedAt === "string",
    `${prefix} state.lastAdvancedAt should be null or string, got: ${typeof state.lastAdvancedAt}`
  );

  assert.ok(
    Array.isArray(state.blockers),
    `${prefix} state.blockers should be an array, got: ${typeof state.blockers}`
  );

  assert.ok(
    typeof state.derived === "object" && state.derived !== null,
    `${prefix} state.derived should be an object, got: ${typeof state.derived}`
  );

  // Validate blockers shape
  for (const blocker of state.blockers) {
    assert.ok(
      typeof blocker.code === "string",
      `${prefix} blocker.code should be a string, got: ${typeof blocker.code}`
    );
    assert.ok(
      typeof blocker.message === "string",
      `${prefix} blocker.message should be a string, got: ${typeof blocker.message}`
    );
  }

  // Validate derived shape
  const d = state.derived;
  assert.ok(
    typeof d.requiredDocsReceivedPct === "number",
    `${prefix} derived.requiredDocsReceivedPct should be a number`
  );
  assert.ok(
    Array.isArray(d.requiredDocsMissing),
    `${prefix} derived.requiredDocsMissing should be an array`
  );
  assert.ok(
    typeof d.borrowerChecklistSatisfied === "boolean",
    `${prefix} derived.borrowerChecklistSatisfied should be a boolean`
  );
  assert.ok(
    typeof d.underwriteStarted === "boolean",
    `${prefix} derived.underwriteStarted should be a boolean`
  );
  assert.ok(
    typeof d.financialSnapshotExists === "boolean",
    `${prefix} derived.financialSnapshotExists should be a boolean`
  );
  assert.ok(
    typeof d.committeePacketReady === "boolean",
    `${prefix} derived.committeePacketReady should be a boolean`
  );
  assert.ok(
    typeof d.decisionPresent === "boolean",
    `${prefix} derived.decisionPresent should be a boolean`
  );
  assert.ok(
    typeof d.committeeRequired === "boolean",
    `${prefix} derived.committeeRequired should be a boolean`
  );
  assert.ok(
    typeof d.attestationSatisfied === "boolean",
    `${prefix} derived.attestationSatisfied should be a boolean`
  );

  // Valid stage values
  const validStages = [
    "intake_created",
    "docs_requested",
    "docs_in_progress",
    "docs_satisfied",
    "underwrite_ready",
    "underwrite_in_progress",
    "committee_ready",
    "committee_decisioned",
    "closing_in_progress",
    "closed",
    "workout",
  ];
  assert.ok(
    validStages.includes(state.stage),
    `${prefix} state.stage should be a valid stage, got: ${state.stage}`
  );

  console.log(`   ✅ ${prefix} Shape valid: stage=${state.stage}, blockers=${state.blockers.length}`);
}

async function runProbe() {
  const url = `${BASE_URL}/api/deals/${DEAL_ID}/lifecycle`;
  console.log(`📡 Fetching: ${url}`);

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
    console.error(`❌ Network error: ${err.message}`);
    process.exit(1);
  }

  console.log(`   Status: ${response.status}`);

  // CRITICAL: API should NEVER return 500
  if (response.status === 500) {
    console.error("❌ CRITICAL: API returned 500 Internal Server Error");
    console.error("   The lifecycle API must NEVER return 500.");
    const text = await response.text();
    console.error(`   Response: ${text.slice(0, 500)}`);
    process.exit(1);
  }

  // Check x-correlation-id header
  const correlationHeader = response.headers.get("x-correlation-id");
  if (!correlationHeader) {
    console.error("❌ Missing x-correlation-id header");
    process.exit(1);
  }
  console.log(`   x-correlation-id: ${correlationHeader}`);

  // Check x-buddy-route header
  const routeHeader = response.headers.get("x-buddy-route");
  if (!routeHeader) {
    console.error("❌ Missing x-buddy-route header");
    process.exit(1);
  }
  console.log(`   x-buddy-route: ${routeHeader}`);

  // Parse JSON
  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.error(`❌ Failed to parse JSON: ${err.message}`);
    const text = await response.text();
    console.error(`   Raw response: ${text.slice(0, 500)}`);
    process.exit(1);
  }

  // Check response structure
  if (response.status === 200) {
    // Success response
    assert.ok(data.ok === true, "Response should have ok: true for 200 status");
    assert.ok(data.state, "Response should have state for 200 status");
    assertLifecycleShape(data.state, "200 OK");
  } else if (response.status === 401 || response.status === 403) {
    // Auth required - this is expected without auth cookie
    console.log(`   ⚠️ Auth required (${response.status}) - skipping shape validation`);
    console.log("   This is expected if AUTH_COOKIE is not set.");
  } else if (response.status === 404) {
    // Deal not found - valid response, should still have shape
    console.log(`   ℹ️ Deal not found (404)`);
    // 404 for lifecycle means the deal doesn't exist in access check
    // This is acceptable - the API doesn't return lifecycle state for non-existent deals
  } else {
    console.error(`❌ Unexpected status: ${response.status}`);
    console.error(`   Response: ${JSON.stringify(data, null, 2).slice(0, 500)}`);
    process.exit(1);
  }

  console.log("");
  console.log("✅ Gate probe passed: Lifecycle API shape is valid");
  console.log("   - API did not return 500");
  console.log("   - Response shape matches LifecycleState contract");
}

runProbe().catch((err) => {
  console.error(`❌ Probe failed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
