#!/usr/bin/env node
/**
 * gate-probe-decision-audit.mjs
 *
 * Live gate probe for Phase F: Credit Decision Audit Export.
 * Verifies: JSON export, PDF export, hash determinism, sealed contract.
 *
 * Usage:
 *   node scripts/gate-probe-decision-audit.mjs --base http://localhost:3000 --deal <dealId> --snapshot <snapshotId> --cookie <session_cookie>
 */

const args = process.argv.slice(2);
function flag(name, fallback = "") {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = flag("base", process.env.API_BASE || "http://localhost:3000");
const DEAL_ID = flag("deal", process.env.DEAL_ID || "");
const SNAPSHOT_ID = flag("snapshot", process.env.SNAPSHOT_ID || "");
const COOKIE = flag("cookie", process.env.SESSION_COOKIE || "");

if (!DEAL_ID || !SNAPSHOT_ID) {
  console.error("Usage: node scripts/gate-probe-decision-audit.mjs --deal <dealId> --snapshot <snapshotId> [--base <url>] [--cookie <session>]");
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

// ── 1) JSON export ──────────────────────────────────────
async function probeJsonExport() {
  console.log("\n=== Probe: GET /api/deals/{id}/decision/audit-export?format=json ===");
  const { res, json } = await fetchJson(
    `${BASE}/api/deals/${DEAL_ID}/decision/audit-export?snapshotId=${SNAPSHOT_ID}&format=json`
  );

  assert("HTTP 200", res.status === 200, `got ${res.status}`);
  assert("x-correlation-id present", Boolean(res.headers.get("x-correlation-id")));
  assert("content-disposition: attachment", res.headers.get("content-disposition") === "attachment");
  assert("x-buddy-snapshot-hash present", Boolean(res.headers.get("x-buddy-snapshot-hash")));
  assert("Response has ok field", typeof json.ok === "boolean");

  if (json.ok) {
    const s = json.snapshot;
    assert("Has snapshot object", Boolean(s));
    assert("Has snapshot_hash", typeof json.snapshot_hash === "string");
    assert("Has generated_at", typeof json.generated_at === "string");

    // Meta
    assert("meta.snapshot_version is 1.0", s?.meta?.snapshot_version === "1.0");
    assert("meta.deal_id present", Boolean(s?.meta?.deal_id));
    assert("meta.snapshot_id present", Boolean(s?.meta?.snapshot_id));

    // Decision
    assert("decision.outcome is string", typeof s?.decision?.outcome === "string");
    assert("decision.status is string", typeof s?.decision?.status === "string");

    // Financials
    assert("financials.completeness_pct is number", typeof s?.financials?.completeness_pct === "number");

    // Policy
    assert("policy.rules_evaluated is number", typeof s?.policy?.rules_evaluated === "number");
    assert("policy.exceptions is array", Array.isArray(s?.policy?.exceptions));

    // Overrides
    assert("overrides is array", Array.isArray(s?.overrides));

    // Attestations
    assert("attestations is array", Array.isArray(s?.attestations));

    // Committee
    assert("committee.quorum is number", typeof s?.committee?.quorum === "number");
    assert("committee.outcome is string", typeof s?.committee?.outcome === "string");
    assert("committee.votes is array", Array.isArray(s?.committee?.votes));

    // Ledger
    assert("ledger_events is array", Array.isArray(s?.ledger_events));

    // Hash header matches body
    const headerHash = res.headers.get("x-buddy-snapshot-hash");
    assert("Header hash matches body hash", headerHash === json.snapshot_hash);

    console.log(`    Decision: ${s?.decision?.outcome}`);
    console.log(`    Status: ${s?.decision?.status}`);
    console.log(`    DSCR: ${s?.financials?.dscr ?? "N/A"}`);
    console.log(`    Rules: ${s?.policy?.rules_evaluated} evaluated, ${s?.policy?.rules_failed} failed`);
    console.log(`    Attestations: ${s?.attestations?.length ?? 0}`);
    console.log(`    Committee: ${s?.committee?.outcome} (${s?.committee?.vote_count} votes)`);
    console.log(`    Hash: ${json.snapshot_hash?.slice(0, 24)}…`);
  } else {
    console.log(`    Error: ${json.error?.code} — ${json.error?.message}`);
  }

  return json;
}

// ── 2) PDF export ───────────────────────────────────────
async function probePdfExport() {
  console.log("\n=== Probe: GET /api/deals/{id}/decision/audit-export?format=pdf ===");
  const { res, json } = await fetchJson(
    `${BASE}/api/deals/${DEAL_ID}/decision/audit-export?snapshotId=${SNAPSHOT_ID}&format=pdf`
  );

  assert("HTTP 200", res.status === 200, `got ${res.status}`);
  assert("Response has ok field", typeof json.ok === "boolean");

  if (json.ok) {
    assert("Has base64 data", typeof json.data === "string" && json.data.length > 0);
    assert("Has filename", typeof json.filename === "string");
    assert("Filename ends with .pdf", json.filename?.endsWith(".pdf"));
    assert("Has contentType", json.contentType === "application/pdf");
    assert("Has snapshot_hash", typeof json.snapshot_hash === "string");
    assert("content-disposition: attachment", res.headers.get("content-disposition") === "attachment");
    assert("x-buddy-snapshot-hash present", Boolean(res.headers.get("x-buddy-snapshot-hash")));
    console.log(`    Filename: ${json.filename}`);
    console.log(`    PDF size: ~${Math.round(json.data.length * 0.75 / 1024)} KB`);
  } else {
    console.log(`    Error: ${json.error?.code} — ${json.error?.message}`);
  }

  return json;
}

// ── 3) Sealed contract checks ───────────────────────────
async function probeSealed() {
  console.log("\n=== Probe: Sealed contract (never-500) checks ===");

  // Bad dealId
  const { res: r1, json: j1 } = await fetchJson(
    `${BASE}/api/deals/not-a-uuid/decision/audit-export?snapshotId=${SNAPSHOT_ID}&format=json`
  );
  assert("Bad dealId → HTTP 200 (not 500)", r1.status === 200);
  assert("Bad dealId → ok:false", j1.ok === false);
  assert("Bad dealId → has error.code", Boolean(j1.error?.code));

  // Missing snapshotId
  const { res: r2, json: j2 } = await fetchJson(
    `${BASE}/api/deals/${DEAL_ID}/decision/audit-export?format=json`
  );
  assert("Missing snapshotId → HTTP 200", r2.status === 200);
  assert("Missing snapshotId → ok:false", j2.ok === false);
  assert("Missing snapshotId → error is missing_snapshot_id", j2.error?.code === "missing_snapshot_id");

  // Bad format
  const { res: r3, json: j3 } = await fetchJson(
    `${BASE}/api/deals/${DEAL_ID}/decision/audit-export?snapshotId=${SNAPSHOT_ID}&format=csv`
  );
  assert("Bad format → HTTP 200", r3.status === 200);
  assert("Bad format → ok:false", j3.ok === false);
  assert("Bad format → error is invalid_format", j3.error?.code === "invalid_format");
}

// ── 4) JSON+PDF hash match ──────────────────────────────
async function probeHashMatch(jsonExport, pdfExport) {
  console.log("\n=== Probe: JSON export hash === PDF export hash ===");

  if (!jsonExport?.ok || !pdfExport?.ok) {
    console.log("    SKIP — one or both exports failed");
    return;
  }

  assert("JSON snapshot_hash matches PDF snapshot_hash", jsonExport.snapshot_hash === pdfExport.snapshot_hash);
  console.log(`    JSON hash: ${jsonExport.snapshot_hash?.slice(0, 16)}…`);
  console.log(`    PDF hash:  ${pdfExport.snapshot_hash?.slice(0, 16)}…`);
}

// ── Run ──
async function main() {
  console.log(`Gate Probe: Credit Decision Audit Export (Phase F)`);
  console.log(`Base: ${BASE}`);
  console.log(`Deal: ${DEAL_ID}`);
  console.log(`Snapshot: ${SNAPSHOT_ID}`);

  const jsonExport = await probeJsonExport();
  const pdfExport = await probePdfExport();
  await probeHashMatch(jsonExport, pdfExport);
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
