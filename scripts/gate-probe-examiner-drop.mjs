#!/usr/bin/env node
/**
 * gate-probe-examiner-drop.mjs
 *
 * Live gate probe for Phase G: Examiner Drop ZIP.
 * Verifies: ZIP generation, manifest integrity, checksums, sealed contract.
 *
 * Usage:
 *   node scripts/gate-probe-examiner-drop.mjs --base http://localhost:3000 --deal <dealId> --snapshot <snapshotId> --cookie <session_cookie>
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
  console.error("Usage: node scripts/gate-probe-examiner-drop.mjs --deal <dealId> --snapshot <snapshotId> [--base <url>] [--cookie <session>]");
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

// ── 1) ZIP generation ───────────────────────────────────
async function probeZipGeneration() {
  console.log("\n=== Probe: GET /api/deals/{id}/examiner-drop?snapshotId=... ===");
  const { res, json } = await fetchJson(
    `${BASE}/api/deals/${DEAL_ID}/examiner-drop?snapshotId=${SNAPSHOT_ID}`
  );

  assert("HTTP 200", res.status === 200, `got ${res.status}`);
  assert("x-correlation-id present", Boolean(res.headers.get("x-correlation-id")));
  assert("content-disposition: attachment", res.headers.get("content-disposition") === "attachment");
  assert("x-buddy-drop-hash present", Boolean(res.headers.get("x-buddy-drop-hash")));
  assert("Response has ok field", typeof json.ok === "boolean");

  if (json.ok) {
    assert("Has base64 data", typeof json.data === "string" && json.data.length > 0);
    assert("Has filename", typeof json.filename === "string");
    assert("Filename ends with .zip", json.filename?.endsWith(".zip"));
    assert("Has contentType", json.contentType === "application/zip");
    assert("Has drop_hash", typeof json.drop_hash === "string");
    assert("Has generated_at", typeof json.generated_at === "string");
    assert("Has manifest", typeof json.manifest === "object");

    console.log(`    Filename: ${json.filename}`);
    console.log(`    ZIP size: ~${Math.round(json.data.length * 0.75 / 1024)} KB`);
    console.log(`    Drop hash: ${json.drop_hash?.slice(0, 24)}…`);
  } else {
    console.log(`    Error: ${json.error?.code} — ${json.error?.message}`);
  }

  return json;
}

// ── 2) Manifest integrity ───────────────────────────────
async function probeManifest(zipExport) {
  console.log("\n=== Probe: Manifest integrity ===");

  if (!zipExport?.ok || !zipExport?.manifest) {
    console.log("    SKIP — export failed or no manifest");
    return;
  }

  const m = zipExport.manifest;

  assert("manifest.drop_version is 1.0", m.drop_version === "1.0");
  assert("manifest.deal_id present", Boolean(m.deal_id));
  assert("manifest.bank_id present", Boolean(m.bank_id));
  assert("manifest.decision_snapshot_id present", Boolean(m.decision_snapshot_id));
  assert("manifest.generated_at is ISO", m.generated_at?.includes("T"));

  assert("manifest.artifacts is array", Array.isArray(m.artifacts));
  assert("manifest has artifacts", m.artifacts.length > 0);

  // Check each artifact has required fields
  for (const a of m.artifacts) {
    assert(`artifact ${a.path} has sha256`, typeof a.sha256 === "string" && a.sha256.length > 0);
    assert(`artifact ${a.path} has size_bytes`, typeof a.size_bytes === "number");
    assert(`artifact ${a.path} has content_type`, typeof a.content_type === "string");
  }

  // Check expected files are present
  const paths = m.artifacts.map((a) => a.path);
  assert("Has credit-decision/snapshot.json", paths.includes("credit-decision/snapshot.json"));
  assert("Has credit-decision/snapshot.pdf", paths.includes("credit-decision/snapshot.pdf"));
  assert("Has README.txt", paths.includes("README.txt"));
  assert("Has integrity/checksums.txt", paths.includes("integrity/checksums.txt"));

  // Optional borrower audit (only if deal has a borrower)
  if (m.borrower_id) {
    assert("Has borrower-audit/snapshot.json", paths.includes("borrower-audit/snapshot.json"));
    assert("Has borrower-audit/snapshot.pdf", paths.includes("borrower-audit/snapshot.pdf"));
    assert("borrower_audit_hash present", typeof m.borrower_audit_hash === "string");
  }

  assert("credit_decision_hash present", typeof m.credit_decision_hash === "string");
  assert("drop_hash present", typeof m.drop_hash === "string");
  assert("drop_hash matches response header hash", m.drop_hash === zipExport.drop_hash);

  console.log(`    Artifacts: ${m.artifacts.length}`);
  console.log(`    Borrower ID: ${m.borrower_id ?? "(none)"}`);
  console.log(`    Decision hash: ${m.credit_decision_hash?.slice(0, 16)}…`);
  console.log(`    Drop hash: ${m.drop_hash?.slice(0, 16)}…`);
}

// ── 3) Sealed contract checks ───────────────────────────
async function probeSealed() {
  console.log("\n=== Probe: Sealed contract (never-500) checks ===");

  // Bad dealId
  const { res: r1, json: j1 } = await fetchJson(
    `${BASE}/api/deals/not-a-uuid/examiner-drop?snapshotId=${SNAPSHOT_ID}`
  );
  assert("Bad dealId → HTTP 200 (not 500)", r1.status === 200);
  assert("Bad dealId → ok:false", j1.ok === false);
  assert("Bad dealId → has error.code", Boolean(j1.error?.code));

  // Missing snapshotId
  const { res: r2, json: j2 } = await fetchJson(
    `${BASE}/api/deals/${DEAL_ID}/examiner-drop`
  );
  assert("Missing snapshotId → HTTP 200", r2.status === 200);
  assert("Missing snapshotId → ok:false", j2.ok === false);
  assert("Missing snapshotId → error is missing_snapshot_id", j2.error?.code === "missing_snapshot_id");

  // Bad snapshotId
  const { res: r3, json: j3 } = await fetchJson(
    `${BASE}/api/deals/${DEAL_ID}/examiner-drop?snapshotId=not-a-uuid`
  );
  assert("Bad snapshotId → HTTP 200", r3.status === 200);
  assert("Bad snapshotId → ok:false", j3.ok === false);
}

// ── Run ──
async function main() {
  console.log(`Gate Probe: Examiner Drop ZIP (Phase G)`);
  console.log(`Base: ${BASE}`);
  console.log(`Deal: ${DEAL_ID}`);
  console.log(`Snapshot: ${SNAPSHOT_ID}`);

  const zipExport = await probeZipGeneration();
  await probeManifest(zipExport);
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
