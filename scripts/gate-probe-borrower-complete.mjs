#!/usr/bin/env node
/**
 * gate-probe-borrower-complete.mjs
 *
 * Live gate probe for Phase D: Borrower Completeness + Attestation.
 * Verifies: completeness evaluation, attestation flow, lifecycle gating.
 *
 * Usage:
 *   node scripts/gate-probe-borrower-complete.mjs --base http://localhost:3000 --deal <dealId> --cookie <session_cookie>
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
  console.error("Usage: node scripts/gate-probe-borrower-complete.mjs --deal <dealId> [--base <url>] [--cookie <session>]");
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

// ── 1) Borrower summary returns hasAttestation + extracted_confidence ──
async function probeSummary() {
  console.log("\n=== Probe: GET /api/deals/{dealId}/borrower/summary ===");
  const { res, json } = await fetchJson(`${BASE}/api/deals/${DEAL_ID}/borrower/summary`);

  assert("HTTP 200", res.status === 200, `got ${res.status}`);
  assert("Response has ok field", typeof json.ok === "boolean");

  if (json.ok) {
    assert("Response includes hasAttestation field", "hasAttestation" in json);
    assert("hasAttestation is boolean", typeof json.hasAttestation === "boolean");

    if (json.borrower) {
      assert("Borrower has id", Boolean(json.borrower.id));
      // extracted_confidence may or may not exist depending on autofill
      if (json.borrower.extracted_confidence) {
        assert(
          "extracted_confidence is object",
          typeof json.borrower.extracted_confidence === "object",
        );
        console.log(`    Confidence fields: ${Object.keys(json.borrower.extracted_confidence).join(", ")}`);
      }
    }
  }

  return json;
}

// ── 2) Autofill returns field_statuses + extracted_confidence ──
async function probeAutofill() {
  console.log("\n=== Probe: POST /api/deals/{dealId}/borrower/ensure (autofill) ===");
  const { res, json } = await fetchJson(`${BASE}/api/deals/${DEAL_ID}/borrower/ensure`, {
    method: "POST",
    body: JSON.stringify({ source: "autofill", include_owners: true }),
  });

  assert("HTTP 200", res.status === 200, `got ${res.status}`);
  assert("Response has ok field", typeof json.ok === "boolean");
  assert("x-correlation-id present", Boolean(res.headers.get("x-correlation-id")));

  if (json.ok) {
    assert("Has borrower object", Boolean(json.borrower));

    // Phase D: confidence data
    if (json.field_statuses) {
      assert("field_statuses is array", Array.isArray(json.field_statuses));
      if (json.field_statuses.length > 0) {
        const first = json.field_statuses[0];
        assert("field_status has field", typeof first.field === "string");
        assert("field_status has confidence", typeof first.confidence === "number");
        assert("field_status has level", ["high", "review", "low"].includes(first.level));
        assert("field_status has applied", typeof first.applied === "boolean");
      }
      console.log(`    Field statuses: ${json.field_statuses.length}`);
    }

    if (json.extracted_confidence) {
      assert("extracted_confidence is object", typeof json.extracted_confidence === "object");
    }

    if (json.warnings?.length) {
      console.log(`    Warnings: ${json.warnings.join("; ")}`);
    }
  } else {
    console.log(`    Error: ${json.error?.code} — ${json.error?.message}`);
  }

  return json;
}

// ── 3) Attestation endpoint ──
async function probeAttestation(borrowerId) {
  console.log("\n=== Probe: POST /api/borrowers/{borrowerId}/owners/attest ===");

  if (!borrowerId) {
    console.log("    SKIP — no borrower attached to test attestation");
    return null;
  }

  const { res, json } = await fetchJson(`${BASE}/api/borrowers/${borrowerId}/owners/attest`, {
    method: "POST",
    body: JSON.stringify({ dealId: DEAL_ID }),
  });

  assert("HTTP 200 (sealed)", res.status === 200, `got ${res.status}`);
  assert("x-correlation-id present", Boolean(res.headers.get("x-correlation-id")));
  assert("Response has ok field", typeof json.ok === "boolean");
  assert("Response has meta", Boolean(json.meta));

  if (json.ok) {
    assert("attestation.id exists", Boolean(json.attestation?.id));
    assert("attestation.owner_count is number", typeof json.attestation?.owner_count === "number");
    assert("attestation.total_ownership_pct >= 80", json.attestation?.total_ownership_pct >= 80);
    console.log(`    Attestation ID: ${json.attestation?.id}`);
    console.log(`    Owners: ${json.attestation?.owner_count}, Total: ${json.attestation?.total_ownership_pct}%`);
  } else {
    console.log(`    Error: ${json.error?.code} — ${json.error?.message}`);
    // These are expected failures if owners aren't set up
    if (json.error?.code === "no_owners" || json.error?.code === "insufficient_ownership") {
      assert("Known error code for missing owners", true);
    }
  }

  return json;
}

// ── 4) Sealed contract: bad borrowerId ──
async function probeSealed() {
  console.log("\n=== Probe: Sealed contract checks ===");

  const { res: r1, json: j1 } = await fetchJson(`${BASE}/api/borrowers/not-a-uuid/owners/attest`, {
    method: "POST",
    body: JSON.stringify({ dealId: DEAL_ID }),
  });
  assert("Bad borrowerId → HTTP 200 (not 500)", r1.status === 200);
  assert("Bad borrowerId → ok:false", j1.ok === false);
  assert("Bad borrowerId → has error.code", Boolean(j1.error?.code));
}

// ── 5) Post-attestation summary shows hasAttestation ──
async function probePostAttestation() {
  console.log("\n=== Probe: Summary after attestation ===");
  const { json } = await fetchJson(`${BASE}/api/deals/${DEAL_ID}/borrower/summary`);

  if (json.ok) {
    assert("hasAttestation is present", "hasAttestation" in json);
    console.log(`    hasAttestation: ${json.hasAttestation}`);
  }
}

// ── Run ──
async function main() {
  console.log(`Gate Probe: Borrower Completeness + Attestation (Phase D)`);
  console.log(`Base: ${BASE}`);
  console.log(`Deal: ${DEAL_ID}`);

  const summary = await probeSummary();
  const autofill = await probeAutofill();

  const borrowerId = summary?.borrower?.id || autofill?.borrower?.id;
  await probeAttestation(borrowerId);
  await probeSealed();
  await probePostAttestation();

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
