#!/usr/bin/env node
/**
 * Gate Probe: Underwrite Start API Shape Validation
 *
 * Prevents regression by validating that POST /api/deals/:id/underwrite/start
 * returns the expected JSON shape and NEVER returns 500.
 *
 * Usage:
 *   node scripts/tests/gate-probe-underwrite-start.mjs [baseUrl] [dealId]
 *
 * Environment:
 *   BASE_URL - Base URL for API (default: http://localhost:3000)
 *   TEST_DEAL_ID - Deal ID to test (optional)
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

console.log("🔍 Gate Probe: Underwrite Start API Shape Validation");
console.log(`   Base URL: ${BASE_URL}`);
console.log(`   Deal ID: ${DEAL_ID}`);
console.log("");

/**
 * Assert the underwrite start response shape is valid.
 */
function assertResponseShape(data, context) {
  const prefix = `[${context}]`;

  // Required top-level fields
  assert.ok(
    typeof data.ok === "boolean",
    `${prefix} response.ok should be a boolean, got: ${typeof data.ok}`
  );

  assert.ok(
    typeof data.meta === "object" && data.meta !== null,
    `${prefix} response.meta should be an object, got: ${typeof data.meta}`
  );

  // Meta fields
  assert.ok(
    typeof data.meta.correlationId === "string" && data.meta.correlationId.length > 0,
    `${prefix} meta.correlationId should be a non-empty string, got: ${data.meta.correlationId}`
  );

  assert.ok(
    typeof data.meta.dealId === "string",
    `${prefix} meta.dealId should be a string, got: ${typeof data.meta.dealId}`
  );

  assert.ok(
    typeof data.meta.ts === "string",
    `${prefix} meta.ts should be a string, got: ${typeof data.meta.ts}`
  );

  // If ok: false, error should be present
  if (!data.ok) {
    assert.ok(
      typeof data.error === "object" && data.error !== null,
      `${prefix} error should be present when ok=false`
    );
    assert.ok(
      typeof data.error.code === "string",
      `${prefix} error.code should be a string, got: ${typeof data.error.code}`
    );
    assert.ok(
      typeof data.error.message === "string",
      `${prefix} error.message should be a string, got: ${typeof data.error.message}`
    );
  }

  // If ok: true, check for expected success fields
  if (data.ok) {
    assert.ok(
      data.pipeline_started === true,
      `${prefix} pipeline_started should be true when ok=true`
    );
  }

  console.log(`   ✅ ${prefix} Shape valid: ok=${data.ok}`);
}

async function runProbe() {
  const url = `${BASE_URL}/api/deals/${DEAL_ID}/underwrite/start`;
  console.log(`📡 POST: ${url}`);

  const headers = {
    "Content-Type": "application/json",
  };

  if (AUTH_COOKIE) {
    headers["Cookie"] = AUTH_COOKIE;
  }

  let response;
  try {
    response = await fetch(url, { method: "POST", headers });
  } catch (err) {
    console.error(`❌ Network error: ${err.message}`);
    process.exit(1);
  }

  console.log(`   Status: ${response.status}`);

  // CRITICAL: API should NEVER return 500
  if (response.status === 500) {
    console.error("❌ CRITICAL: API returned 500 Internal Server Error");
    console.error("   The underwrite/start API must NEVER return 500.");
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

  // Check response structure (always expect 200)
  if (response.status === 200) {
    assertResponseShape(data, data.ok ? "200 OK" : "200 Error");
  } else {
    console.error(`❌ Unexpected status: ${response.status}`);
    console.error(`   Response: ${JSON.stringify(data, null, 2).slice(0, 500)}`);
    process.exit(1);
  }

  console.log("");
  console.log("✅ Gate probe passed: Underwrite Start API shape is valid");
  console.log("   - API did not return 500");
  console.log("   - x-correlation-id header present");
  console.log("   - x-buddy-route header present");
  console.log("   - Response shape matches contract");
}

runProbe().catch((err) => {
  console.error(`❌ Probe failed: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
