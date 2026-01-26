#!/usr/bin/env node
/**
 * Gate Probe: Checklist List API Shape Validation
 *
 * Validates that /api/deals/[dealId]/checklist/list follows the Never-500 contract:
 * - Always returns HTTP 200
 * - Always includes x-correlation-id header
 * - Always includes x-buddy-route header
 * - Returns parseable JSON with ok field
 */

const BASE_URL = process.env.APP_URL || "http://localhost:3000";
const DEAL_ID = process.env.DEAL_ID || "00000000-0000-0000-0000-000000000000";

async function main() {
  console.log("🔍 Gate Probe: Checklist List API Shape Validation");
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Deal ID: ${DEAL_ID}`);
  console.log("");

  const url = `${BASE_URL}/api/deals/${DEAL_ID}/checklist/list`;
  console.log(`📡 Fetching: ${url}`);

  const res = await fetch(url);
  const correlationId = res.headers.get("x-correlation-id");
  const buddyRoute = res.headers.get("x-buddy-route");

  console.log(`   Status: ${res.status}`);
  console.log(`   x-correlation-id: ${correlationId || "(missing)"}`);
  console.log(`   x-buddy-route: ${buddyRoute || "(missing)"}`);

  // Assertion 1: HTTP 200
  if (res.status !== 200) {
    console.error(`❌ FAIL: Expected HTTP 200, got ${res.status}`);
    process.exit(1);
  }

  // Assertion 2: x-correlation-id present
  if (!correlationId) {
    console.error("❌ FAIL: Missing x-correlation-id header");
    process.exit(1);
  }

  // Assertion 3: x-buddy-route present
  if (!buddyRoute) {
    console.error("❌ FAIL: Missing x-buddy-route header");
    process.exit(1);
  }

  // Assertion 4: x-buddy-route matches expected pattern
  if (!buddyRoute.includes("checklist/list")) {
    console.error(`❌ FAIL: x-buddy-route should include 'checklist/list', got: ${buddyRoute}`);
    process.exit(1);
  }

  // Assertion 5: JSON parseable
  let body;
  try {
    body = await res.json();
  } catch (e) {
    console.error("❌ FAIL: Response is not valid JSON");
    process.exit(1);
  }

  // Assertion 6: ok field present
  if (typeof body.ok !== "boolean") {
    console.error("❌ FAIL: Response missing 'ok' field");
    process.exit(1);
  }

  // Assertion 7: items array present
  if (!Array.isArray(body.items)) {
    console.error("❌ FAIL: Response missing 'items' array");
    process.exit(1);
  }

  console.log(`   ✅ [200 ${body.ok ? "Success" : "Error"}] Shape valid: ok=${body.ok}, items=${body.items.length}`);
  console.log("");
  console.log("✅ Gate probe passed: Checklist List API shape is valid");
  console.log("   - API did not return 500");
  console.log("   - x-correlation-id header present");
  console.log("   - x-buddy-route header present");
  console.log("   - Response shape matches contract");
}

main().catch((err) => {
  console.error("❌ Gate probe failed with exception:", err.message);
  process.exit(1);
});
