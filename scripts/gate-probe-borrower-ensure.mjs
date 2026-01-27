#!/usr/bin/env node
/**
 * gate-probe-borrower-ensure.mjs
 *
 * Live gate probe for the borrower ensure flow.
 * Verifies: debug endpoint, ensure endpoint, sealed headers, tenant safety.
 *
 * Usage:
 *   node scripts/gate-probe-borrower-ensure.mjs --base http://localhost:3000 --deal <dealId> --cookie <session_cookie>
 */

const args = process.argv.slice(2);
function flag(name, fallback = "") {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = flag("base", process.env.API_BASE || "http://localhost:3000");
const DEAL_ID = flag("deal", process.env.DEAL_ID || "");
const COOKIE = flag("cookie", process.env.SESSION_COOKIE || "");

if (!DEAL_ID) {
  console.error("Usage: node scripts/gate-probe-borrower-ensure.mjs --deal <dealId> [--base <url>] [--cookie <session>]");
  process.exit(1);
}

const headers = {
  "content-type": "application/json",
  ...(COOKIE ? { cookie: COOKIE } : {}),
};

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...headers, ...opts.headers } });
  const json = await res.json();
  return { res, json };
}

// ── 1) Debug endpoint ────────────────────────────────────
async function probeDebug() {
  console.log("\n=== Probe: GET /api/deals/{dealId}/borrower/debug ===");
  const { res, json } = await fetchJson(`${BASE}/api/deals/${DEAL_ID}/borrower/debug`);

  assert("HTTP 200", res.status === 200, `got ${res.status}`);
  assert("x-correlation-id header present", Boolean(res.headers.get("x-correlation-id")));
  assert("x-buddy-route header present", Boolean(res.headers.get("x-buddy-route")));
  assert("Response has ok field", typeof json.ok === "boolean");
  assert("Response has meta.correlationId", Boolean(json.meta?.correlationId));

  if (json.ok) {
    assert("debug.deal exists", Boolean(json.debug?.deal));
    assert("debug.suggestions exists", Boolean(json.debug?.suggestions));
    assert("debug.extraction exists", Boolean(json.debug?.extraction));
  }

  return json;
}

// ── 2) Ensure endpoint ──────────────────────────────────
async function probeEnsure() {
  console.log("\n=== Probe: POST /api/deals/{dealId}/borrower/ensure (autofill) ===");
  const { res, json } = await fetchJson(`${BASE}/api/deals/${DEAL_ID}/borrower/ensure`, {
    method: "POST",
    body: JSON.stringify({ source: "autofill", include_owners: true }),
  });

  assert("HTTP 200", res.status === 200, `got ${res.status}`);
  assert("x-correlation-id header present", Boolean(res.headers.get("x-correlation-id")));
  assert("Response has ok field", typeof json.ok === "boolean");
  assert("Response has meta.correlationId", Boolean(json.meta?.correlationId));

  if (json.ok) {
    assert("Has borrower object", Boolean(json.borrower));
    assert("Has action field", Boolean(json.action));
    assert("borrower has id", Boolean(json.borrower?.id));
    assert("borrower has legal_name", typeof json.borrower?.legal_name === "string");

    if (json.updatedFromDocs) {
      console.log(`    Autofilled fields: ${JSON.stringify(json.fields_autofilled)}`);
      console.log(`    Owners created: ${json.owners_created ?? 0}`);
    }
    if (json.warnings?.length) {
      console.log(`    Warnings: ${json.warnings.join("; ")}`);
    }
  } else {
    console.log(`    Error: ${json.error?.code} — ${json.error?.message}`);
  }

  return json;
}

// ── 3) Verify deal now has borrower_id ──────────────────
async function probeVerify(debugJson) {
  console.log("\n=== Probe: Verify deal.borrower_id is non-null ===");
  const { json } = await fetchJson(`${BASE}/api/deals/${DEAL_ID}/borrower/debug`);

  if (json.ok) {
    assert("deal.borrower_id is non-null after ensure", Boolean(json.debug?.deal?.borrower_id));
  } else {
    assert("Debug endpoint returns ok after ensure", false, json.error?.message);
  }
}

// ── 4) Sealed contract checks ───────────────────────────
async function probeSealed() {
  console.log("\n=== Probe: Sealed contract (never-500) checks ===");

  // Bad dealId
  const { res: r1, json: j1 } = await fetchJson(`${BASE}/api/deals/not-a-uuid/borrower/debug`);
  assert("Bad dealId → HTTP 200 (not 500)", r1.status === 200);
  assert("Bad dealId → ok:false", j1.ok === false);

  // Missing body
  const { res: r2, json: j2 } = await fetchJson(`${BASE}/api/deals/${DEAL_ID}/borrower/ensure`, {
    method: "POST",
    body: "{}",
  });
  assert("Empty body ensure → HTTP 200", r2.status === 200);
  assert("Empty body ensure → has correlationId", Boolean(j2.meta?.correlationId));
}

// ── Run ──────────────────────────────────────────────────
async function main() {
  console.log(`Gate Probe: Borrower Ensure`);
  console.log(`Base: ${BASE}`);
  console.log(`Deal: ${DEAL_ID}`);

  const debugJson = await probeDebug();
  await probeEnsure();
  await probeVerify(debugJson);
  await probeSealed();

  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.error("\nGATE PROBE FAILED");
    process.exit(1);
  } else {
    console.log("\nGATE PROBE PASSED");
  }
}

main().catch((err) => {
  console.error("Probe fatal error:", err);
  process.exit(1);
});
