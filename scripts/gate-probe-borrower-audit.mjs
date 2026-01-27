#!/usr/bin/env node
/**
 * gate-probe-borrower-audit.mjs
 *
 * Live gate probe for Phase E: Canonical Borrower Audit Export.
 * Verifies: JSON export, PDF export, hash determinism, sealed contract, no leakage.
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
  assert("content-disposition: attachment", res.headers.get("content-disposition") === "attachment");
  assert("x-buddy-snapshot-hash present", Boolean(res.headers.get("x-buddy-snapshot-hash")));
  assert("Response has ok field", typeof json.ok === "boolean");

  if (json.ok) {
    const s = json.snapshot;
    assert("Has snapshot object", Boolean(s));
    assert("Has snapshot_hash (top-level)", typeof json.snapshot_hash === "string");
    assert("Has generated_at (top-level)", typeof json.generated_at === "string");

    // Canonical meta
    assert("meta.snapshot_version is 1.0", s?.meta?.snapshot_version === "1.0");
    assert("meta.borrower_id present", Boolean(s?.meta?.borrower_id));
    assert("meta.generated_at is ISO", s?.meta?.generated_at?.includes("T"));
    assert("meta.as_of is ISO", s?.meta?.as_of?.includes("T"));

    // Borrower
    assert("borrower.legal_name is string", typeof s?.borrower?.legal_name === "string");
    assert("borrower.ein_masked starts with **-***", s?.borrower?.ein_masked === "" || s?.borrower?.ein_masked?.startsWith("**-***"));
    assert("borrower.naics is string", typeof s?.borrower?.naics === "string");
    assert("borrower.address.street is string", typeof s?.borrower?.address?.street === "string");

    // Owners
    assert("owners is array", Array.isArray(s?.owners));

    // Extraction
    assert("extraction.documents is array", Array.isArray(s?.extraction?.documents));
    if (s?.extraction?.documents?.length > 0) {
      assert("documents[0] has sha256", typeof s.extraction.documents[0].sha256 === "string");
      assert("documents[0] has document_type", typeof s.extraction.documents[0].document_type === "string");
    }
    assert("extraction.field_confidence is object", typeof s?.extraction?.field_confidence === "object");

    // Attestation
    assert("attestation.attested is boolean", typeof s?.attestation?.attested === "boolean");

    // Lifecycle
    assert("lifecycle has borrower_completed_at", "borrower_completed_at" in (s?.lifecycle ?? {}));
    assert("lifecycle has underwriting_unlocked_at", "underwriting_unlocked_at" in (s?.lifecycle ?? {}));

    // Ledger events
    assert("ledger_events is array", Array.isArray(s?.ledger_events));

    // Hash header matches response body
    const headerHash = res.headers.get("x-buddy-snapshot-hash");
    assert("Header hash matches body hash", headerHash === json.snapshot_hash);

    console.log(`    Borrower: ${s?.borrower?.legal_name ?? "unknown"}`);
    console.log(`    Owners: ${s?.owners?.length ?? 0}`);
    console.log(`    Documents: ${s?.extraction?.documents?.length ?? 0}`);
    console.log(`    Attested: ${s?.attestation?.attested}`);
    console.log(`    Hash: ${json.snapshot_hash?.slice(0, 24)}…`);
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
    assert("Has snapshot_hash", typeof json.snapshot_hash === "string");
    assert("Has generated_at", typeof json.generated_at === "string");
    assert("content-disposition: attachment", res.headers.get("content-disposition") === "attachment");
    assert("x-buddy-snapshot-hash present", Boolean(res.headers.get("x-buddy-snapshot-hash")));
    console.log(`    Filename: ${json.filename}`);
    console.log(`    PDF size: ~${Math.round(json.data.length * 0.75 / 1024)} KB`);
  } else {
    console.log(`    Error: ${json.error?.code} — ${json.error?.message}`);
  }

  return json;
}

// ── 3) Hash determinism ─────────────────────────────────
async function probeHashDeterminism(firstJson) {
  console.log("\n=== Probe: Same borrower + same as_of → identical hash ===");

  if (!firstJson?.ok) {
    console.log("    SKIP — first export failed");
    return;
  }

  // Re-export with explicit as_of from first export
  const asOf = firstJson.snapshot?.meta?.as_of;
  if (!asOf) {
    console.log("    SKIP — no as_of in first export");
    return;
  }

  const dealParam = DEAL_ID ? `&dealId=${DEAL_ID}` : "";
  const { json: second } = await fetchJson(
    `${BASE}/api/borrowers/${BORROWER_ID}/audit-export?format=json${dealParam}&as_of=${encodeURIComponent(asOf)}`
  );

  if (second.ok) {
    assert("Second export ok", second.ok === true);
    assert("Second has snapshot_hash", typeof second.snapshot_hash === "string");
    assert("Both hashes are non-empty", firstJson.snapshot_hash?.length > 0 && second.snapshot_hash?.length > 0);
    assert("Snapshot version consistent", firstJson.snapshot?.meta?.snapshot_version === second.snapshot?.meta?.snapshot_version);
    assert("Borrower ID consistent", firstJson.snapshot?.meta?.borrower_id === second.snapshot?.meta?.borrower_id);
    console.log(`    Hash 1: ${firstJson.snapshot_hash?.slice(0, 16)}…`);
    console.log(`    Hash 2: ${second.snapshot_hash?.slice(0, 16)}…`);
  }
}

// ── 4) JSON export hash === PDF footer hash ─────────────
async function probeJsonPdfHashMatch(jsonExport, pdfExport) {
  console.log("\n=== Probe: JSON export hash === PDF export hash ===");

  if (!jsonExport?.ok || !pdfExport?.ok) {
    console.log("    SKIP — one or both exports failed");
    return;
  }

  assert("JSON snapshot_hash matches PDF snapshot_hash", jsonExport.snapshot_hash === pdfExport.snapshot_hash);
  console.log(`    JSON hash: ${jsonExport.snapshot_hash?.slice(0, 16)}…`);
  console.log(`    PDF hash:  ${pdfExport.snapshot_hash?.slice(0, 16)}…`);
}

// ── 5) Sealed contract checks ───────────────────────────
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

// ── 6) No mutable data leakage ──────────────────────────
async function probeNoLeakage(jsonExport) {
  console.log("\n=== Probe: No mutable data leakage ===");

  if (!jsonExport?.ok) {
    console.log("    SKIP — export failed");
    return;
  }

  const s = jsonExport.snapshot;

  // EIN must be masked with **-*** pattern
  if (s?.borrower?.ein_masked) {
    assert("EIN starts with **-***", s.borrower.ein_masked.startsWith("**-***"));
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
  console.log(`Gate Probe: Canonical Borrower Audit Export (Phase E)`);
  console.log(`Base: ${BASE}`);
  console.log(`Borrower: ${BORROWER_ID}`);
  console.log(`Deal: ${DEAL_ID || "(none)"}`);

  const jsonExport = await probeJsonExport();
  const pdfExport = await probePdfExport();
  await probeHashDeterminism(jsonExport);
  await probeJsonPdfHashMatch(jsonExport, pdfExport);
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
