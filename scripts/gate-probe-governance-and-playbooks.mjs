#!/usr/bin/env node
/**
 * gate-probe-governance-and-playbooks.mjs
 *
 * Live gate probe for Phase H + Phase I:
 *  - Phase H: Model Governance Appendix API
 *  - Phase I: Examiner Playbook Export API
 *
 * Verifies: governance contract, playbook completeness, hash determinism, sealed contract.
 *
 * Usage:
 *   node scripts/gate-probe-governance-and-playbooks.mjs --base http://localhost:3000 --cookie <session_cookie>
 */

const args = process.argv.slice(2);
function flag(name, fallback = "") {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = flag("base", process.env.API_BASE || "http://localhost:3000");
const COOKIE = flag("cookie", process.env.SESSION_COOKIE || "");

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

// ── 1) Governance Appendix API ──────────────────────────
async function probeGovernanceAppendix() {
  console.log("\n=== Probe: GET /api/governance/model-appendix ===");
  const { res, json } = await fetchJson(`${BASE}/api/governance/model-appendix`);

  assert("HTTP 200", res.status === 200, `got ${res.status}`);
  assert("x-correlation-id present", Boolean(res.headers.get("x-correlation-id")));
  assert("Response has ok field", typeof json.ok === "boolean");

  if (json.ok) {
    const a = json.appendix;
    assert("Has appendix object", Boolean(a));

    // Governance version
    assert("governance_version is 1.0", a?.governance_version === "1.0");

    // Registry
    assert("registry is array", Array.isArray(a?.registry));
    assert("registry has 4 models", a?.registry?.length === 4);

    // Check all models are assistive-only
    if (Array.isArray(a?.registry)) {
      for (const m of a.registry) {
        assert(`${m.model_id}: assistive-only`, m.decision_authority === "assistive-only");
        assert(`${m.model_id}: human_override_required`, m.human_override_required === true);
        assert(`${m.model_id}: has purpose`, typeof m.purpose === "string" && m.purpose.length > 0);
        assert(`${m.model_id}: has input_scope`, Array.isArray(m.input_scope) && m.input_scope.length > 0);
        assert(`${m.model_id}: has output_scope`, Array.isArray(m.output_scope) && m.output_scope.length > 0);
      }
    }

    // Explainability
    assert("explainability is array", Array.isArray(a?.explainability));
    assert("explainability has 4 entries", a?.explainability?.length === 4);

    if (Array.isArray(a?.explainability)) {
      for (const ex of a.explainability) {
        assert(`explain ${ex.model_id}: has limitations`, Array.isArray(ex.limitations) && ex.limitations.length > 0);
        assert(`explain ${ex.model_id}: has confidence_notes`, Array.isArray(ex.confidence_notes) && ex.confidence_notes.length > 0);
      }
    }

    // Override policy
    assert("override_policy.override_is_mandatory", a?.override_policy?.override_is_mandatory === true);
    assert("override_policy.override_appears_in is array", Array.isArray(a?.override_policy?.override_appears_in));

    // Human-in-the-loop
    assert("human_in_the_loop has guarantees", Array.isArray(a?.human_in_the_loop?.guarantees));
    assert("human_in_the_loop has >= 3 guarantees", a?.human_in_the_loop?.guarantees?.length >= 3);

    // Invariant check
    assert("invariant_check.ok is true", a?.invariant_check?.ok === true);
    assert("invariant_check has no violations", a?.invariant_check?.violations?.length === 0);

    console.log(`    Models: ${a?.registry?.length}`);
    console.log(`    Explainability entries: ${a?.explainability?.length}`);
    console.log(`    Invariant OK: ${a?.invariant_check?.ok}`);
  } else {
    console.log(`    Error: ${json.error?.code} — ${json.error?.message}`);
  }

  return json;
}

// ── 2) Playbook Export JSON ─────────────────────────────
async function probePlaybookJson() {
  console.log("\n=== Probe: GET /api/examiner/playbooks?format=json ===");
  const { res, json } = await fetchJson(`${BASE}/api/examiner/playbooks?format=json`);

  assert("HTTP 200", res.status === 200, `got ${res.status}`);
  assert("x-correlation-id present", Boolean(res.headers.get("x-correlation-id")));
  assert("content-disposition: attachment", res.headers.get("content-disposition") === "attachment");
  assert("x-buddy-playbook-hash present", Boolean(res.headers.get("x-buddy-playbook-hash")));
  assert("Response has ok field", typeof json.ok === "boolean");

  if (json.ok) {
    const pb = json.playbooks;
    assert("Has playbooks object", Boolean(pb));
    assert("Has playbook_hash", typeof json.playbook_hash === "string");
    assert("Has generated_at", typeof json.generated_at === "string");

    // Playbook version
    assert("playbook_version is 1.0", pb?.playbook_version === "1.0");

    // All 7 playbook sections
    const sections = [
      "system_overview",
      "underwriting_flow",
      "ai_usage_explanation",
      "borrower_verification",
      "credit_decision_process",
      "override_handling",
      "audit_artifacts_map",
    ];
    for (const s of sections) {
      assert(`Has ${s}`, typeof pb?.[s] === "string" && pb[s].length > 0);
    }

    // No marketing language
    const allText = JSON.stringify(pb).toLowerCase();
    const marketingWords = ["revolutionary", "game-changing", "cutting-edge", "world-class", "best-in-class"];
    for (const word of marketingWords) {
      assert(`No marketing: "${word}"`, !allText.includes(word));
    }

    console.log(`    Playbook version: ${pb?.playbook_version}`);
    console.log(`    Hash: ${json.playbook_hash?.slice(0, 24)}…`);
    console.log(`    Sections: ${sections.filter((s) => pb?.[s]).length}/7`);
  } else {
    console.log(`    Error: ${json.error?.code} — ${json.error?.message}`);
  }

  return json;
}

// ── 3) Playbook Export PDF ──────────────────────────────
async function probePlaybookPdf() {
  console.log("\n=== Probe: GET /api/examiner/playbooks?format=pdf ===");
  const { res, json } = await fetchJson(`${BASE}/api/examiner/playbooks?format=pdf`);

  assert("HTTP 200", res.status === 200, `got ${res.status}`);
  assert("Response has ok field", typeof json.ok === "boolean");

  if (json.ok) {
    assert("Has base64 data", typeof json.data === "string" && json.data.length > 0);
    assert("Has filename", typeof json.filename === "string");
    assert("Filename ends with .pdf", json.filename?.endsWith(".pdf"));
    assert("Has contentType", json.contentType === "application/pdf");
    assert("Has playbook_hash", typeof json.playbook_hash === "string");
    assert("content-disposition: attachment", res.headers.get("content-disposition") === "attachment");
    assert("x-buddy-playbook-hash present", Boolean(res.headers.get("x-buddy-playbook-hash")));
    console.log(`    Filename: ${json.filename}`);
    console.log(`    PDF size: ~${Math.round(json.data.length * 0.75 / 1024)} KB`);
  } else {
    console.log(`    Error: ${json.error?.code} — ${json.error?.message}`);
  }

  return json;
}

// ── 4) Hash determinism ─────────────────────────────────
async function probeHashDeterminism(jsonExport1) {
  console.log("\n=== Probe: Playbook hash determinism ===");

  if (!jsonExport1?.ok) {
    console.log("    SKIP — first export failed");
    return;
  }

  const { json: jsonExport2 } = await fetchJson(`${BASE}/api/examiner/playbooks?format=json`);

  if (!jsonExport2?.ok) {
    console.log("    SKIP — second export failed");
    return;
  }

  assert(
    "JSON hash is deterministic across calls",
    jsonExport1.playbook_hash === jsonExport2.playbook_hash,
    `${jsonExport1.playbook_hash?.slice(0, 16)} !== ${jsonExport2.playbook_hash?.slice(0, 16)}`,
  );

  // Content should be identical (static playbooks)
  const sections = [
    "system_overview",
    "underwriting_flow",
    "ai_usage_explanation",
    "borrower_verification",
    "credit_decision_process",
    "override_handling",
    "audit_artifacts_map",
  ];
  for (const s of sections) {
    assert(
      `${s} content is identical across calls`,
      jsonExport1.playbooks?.[s] === jsonExport2.playbooks?.[s],
    );
  }
}

// ── 5) Sealed contract checks ───────────────────────────
async function probeSealed() {
  console.log("\n=== Probe: Sealed contract (never-500) checks ===");

  // Bad format for playbooks
  const { res: r1, json: j1 } = await fetchJson(
    `${BASE}/api/examiner/playbooks?format=csv`,
  );
  assert("Bad format → HTTP 200", r1.status === 200);
  assert("Bad format → ok:false", j1.ok === false);
  assert("Bad format → error is invalid_format", j1.error?.code === "invalid_format");
}

// ── Run ──
async function main() {
  console.log(`Gate Probe: Model Governance & Examiner Playbooks (Phase H + I)`);
  console.log(`Base: ${BASE}`);

  const govResult = await probeGovernanceAppendix();
  const jsonExport = await probePlaybookJson();
  const pdfExport = await probePlaybookPdf();
  await probeHashDeterminism(jsonExport);
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
