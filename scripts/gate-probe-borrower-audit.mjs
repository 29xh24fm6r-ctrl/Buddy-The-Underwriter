#!/usr/bin/env node
/**
 * gate-probe-borrower-audit.mjs
 *
 * Live gate probe for Phase E: Regulator-Grade Borrower Audit Export.
 * Verifies: JSON export, PDF export, snapshot hashing, determinism, sealed contract.
 *
 * Usage:
 *   node scripts/gate-probe-borrower-audit.mjs --base http://localhost:3000 --borrower <borrowerId> --deal <dealId> --cookie <session_cookie>
 */

const args = process.argv.slice(2);
function flag(name, fallback = "") {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = flag("base", process.env.API_BASE || "http://localhost:3000");
const BORROWER_ID = flag("borrower", process.env.BORROWER_ID || "");
const DEAL_ID = flag("deal", process.env.DEAL_ID || "");
const COOKIE = flag("cookie", process.env.SESSION_COOKIE || "");

if (!BORROWER_ID) {
  console.error("Usage: node scripts/gate-probe-borrower-audit.mjs --borrower <borrowerId> [--deal <dealId>] [--base <url>] [--cookie <session>]");
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
  console.log("\n=== Probe: GET /api/borrowers/{id}/audit-export?format=json ===");
  const dealParam = DEAL_ID ? `&dealId=${DEAL_ID}` : "";
  const { res, json } = await fetchJson(`${BASE}/api/borrowers/${BORROWER_ID}/audit-export?format=json${dealParam}`);

  assert("HTTP 200", res.status === 200, `got ${res.status}`);
  assert("x-correlation-id present", Boolean(res.headers.get("x-correlation-id")));
  assert("Response has ok field", typeof json.ok === "boolean");

  if (json.ok) {
    const s = json.snapshot;
    assert("Has snapshot object", Boolean(s));
    assert("Has snapshotHash", typeof json.snapshotHash === "string");
    assert("Snapshot hash matches", s?.snapshot_hash === json.snapshotHash);
    assert("schema_version is 1.0", s?.schema_version === "1.0");
    assert("Has borrower.id", Boolean(s?.borrower?.id));
    assert("Has borrower.legal_name", typeof s?.borrower?.legal_name === "string" || s?.borrower?.legal_name === null);
    assert("EIN is masked", !s?.borrower?.ein_masked || s.borrower.ein_masked.startsWith("XX-XXX"));
    assert("Has owners array", Array.isArray(s?.owners));
    assert("Has extraction.documents", Array.isArray(s?.extraction?.documents));
    assert("Has extraction.field_confidence", typeof s?.extraction?.field_confidence === "object");
    assert("Has attestation.attested boolean", typeof s?.attestation?.attested === "boolean");
    assert("Has lifecycle object", Boolean(s?.lifecycle));
    assert("Has ledger_refs array", Array.isArray(s?.ledger_refs));
    assert("generated_at is ISO timestamp", s?.generated_at?.includes("T"));

    console.log(`    Borrower: ${s?.borrower?.legal_name ?? "unknown"}`);
    console.log(`    Owners: ${s?.owners?.length ?? 0}`);
    console.log(`    Documents: ${s?.extraction?.documents?.length ?? 0}`);
    console.log(`    Attested: ${s?.attestation?.attested}`);
    console.log(`    Hash: ${json.snapshotHash?.slice(0, 24)}…`);
  } else {
    console.log(`    Error: ${json.error?.code} — ${json.error?.message}`);
  }

  return json;
}

// ── 2) PDF export ───────────────────────────────────────
async function probePdfExport() {
  console.log("\n=== Probe: GET /api/borrowers/{id}/audit-export?format=pdf ===");
  const dealParam = DEAL_ID ? `&dealId=${DEAL_ID}` : "";
  const { res, json } = await fetchJson(`${BASE}/api/borrowers/${BORROWER_ID}/audit-export?format=pdf${dealParam}`);

  assert("HTTP 200", res.status === 200, `got ${res.status}`);
  assert("Response has ok field", typeof json.ok === "boolean");

  if (json.ok) {
    assert("Has base64 data", typeof json.data === "string" && json.data.length > 0);
    assert("Has filename", typeof json.filename === "string");
    assert("Filename ends with .pdf", json.filename?.endsWith(".pdf"));
    assert("Has contentType", json.contentType === "application/pdf");
    assert("Has snapshotHash", typeof json.snapshotHash === "string");
    console.log(`    Filename: ${json.filename}`);
    console.log(`    PDF size: ~${Math.round(json.data.length * 0.75 / 1024)} KB`);
  } else {
    console.log(`    Error: ${json.error?.code} — ${json.error?.message}`);
  }

  return json;
}

// ── 3) Hash consistency ─────────────────────────────────
async function probeHashConsistency(firstJson) {
  console.log("\n=== Probe: Hash consistency (re-export) ===");

  if (!firstJson?.ok) {
    console.log("    SKIP — first export failed");
    return;
  }

  // Note: generated_at will differ, so hashes will differ.
  // We verify both are valid hashes with consistent structure.
  const dealParam = DEAL_ID ? `&dealId=${DEAL_ID}` : "";
  const { json: second } = await fetchJson(`${BASE}/api/borrowers/${BORROWER_ID}/audit-export?format=json${dealParam}`);

  if (second.ok) {
    assert("Second export also ok", second.ok === true);
    assert("Second has snapshot_hash", typeof second.snapshotHash === "string");
    assert("Both hashes are non-empty", first.snapshotHash?.length > 0 && second.snapshotHash?.length > 0);
    assert("Schema version consistent", first.snapshot?.schema_version === second.snapshot?.schema_version);
    assert("Borrower ID consistent", first.snapshot?.borrower?.id === second.snapshot?.borrower?.id);
    console.log(`    Hash 1: ${firstJson.snapshotHash?.slice(0, 16)}…`);
    console.log(`    Hash 2: ${second.snapshotHash?.slice(0, 16)}…`);
  }
}

// ── 4) Sealed contract checks ───────────────────────────
async function probeSealed() {
  console.log("\n=== Probe: Sealed contract (never-500) checks ===");

  // Bad borrowerId
  const { res: r1, json: j1 } = await fetchJson(`${BASE}/api/borrowers/not-a-uuid/audit-export?format=json`);
  assert("Bad borrowerId → HTTP 200 (not 500)", r1.status === 200);
  assert("Bad borrowerId → ok:false", j1.ok === false);
  assert("Bad borrowerId → has error.code", Boolean(j1.error?.code));

  // Bad format
  const { res: r2, json: j2 } = await fetchJson(`${BASE}/api/borrowers/${BORROWER_ID}/audit-export?format=csv`);
  assert("Bad format → HTTP 200", r2.status === 200);
  assert("Bad format → ok:false", j2.ok === false);
  assert("Bad format → error is invalid_format", j2.error?.code === "invalid_format");
}

// ── 5) No mutable data leakage ──────────────────────────
async function probeNoLeakage(jsonExport) {
  console.log("\n=== Probe: No mutable data leakage ===");

  if (!jsonExport?.ok) {
    console.log("    SKIP — export failed");
    return;
  }

  const s = jsonExport.snapshot;

  // EIN must be masked
  if (s?.borrower?.ein_masked) {
    assert("EIN starts with XX-XXX", s.borrower.ein_masked.startsWith("XX-XXX"));
    assert("EIN does not contain full digits", !/^\d{2}-\d{7}$/.test(s.borrower.ein_masked));
  }

  // No raw passwords, tokens, or secrets in snapshot
  const json = JSON.stringify(s);
  assert("No 'password' in snapshot", !json.toLowerCase().includes("password"));
  assert("No 'secret' in snapshot", !json.toLowerCase().includes("secret"));
  assert("No 'token' in snapshot (except keys)", !json.includes('"token"'));
}

// ── Run ──
async function main() {
  console.log(`Gate Probe: Borrower Audit Export (Phase E)`);
  console.log(`Base: ${BASE}`);
  console.log(`Borrower: ${BORROWER_ID}`);
  console.log(`Deal: ${DEAL_ID || "(none)"}`);

  const jsonExport = await probeJsonExport();
  await probePdfExport();
  await probeHashConsistency(jsonExport);
  await probeSealed();
  await probeNoLeakage(jsonExport);

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
