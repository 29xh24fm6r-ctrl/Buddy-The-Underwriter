#!/usr/bin/env node
/**
 * guard-reference-dataset-coverage
 *
 * SPEC-SBA-SIZE-STANDARDS-REFERENCE-1, Phase 1.
 *
 * Fails CI if Buddy ever regresses to shipping a small hard-coded SBA
 * size-standard table, or if the generated reference artifact is missing,
 * truncated, or has been edited by hand after generation.
 *
 * Background: production carried a 52-entry placeholder table
 * (src/lib/score/eligibility/sbaSizeStandards.ts, "PLACEHOLDER (top-50
 * NAICS)") that default-denied every NAICS outside it. Every SBA score ever
 * computed in production came back score=0 / eligibility_passed=false. This
 * guard exists so that specific failure can never be reintroduced quietly.
 *
 * Checks:
 *   1. The generated artifact exists and parses.
 *   2. It passes the SAME validator the runtime loader uses.
 *   3. Its records hash matches the manifest (no post-generation edits).
 *   4. No source file under src/ declares an inline size-standard table.
 *
 * Phase 1 note: until the artifact is generated (which requires network
 * egress to the official source), checks 1-3 report NOT_GENERATED and exit
 * non-zero. That is intentional and correct — a missing authoritative
 * dataset is a build failure, not a silent fallback.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data", "reference");
const DATASET = path.join(DATA_DIR, "sba-size-standards.json");
const MANIFEST = path.join(DATA_DIR, "sba-size-standards.manifest.json");
const SRC = path.join(ROOT, "src");

/**
 * Two INDEPENDENT conditions, reported separately (Phase 1 requirement):
 *
 *   A. ARTIFACT VALIDATION — is the generated reference dataset present,
 *      internally consistent, and unmodified since generation? This must
 *      PASS once the artifact exists.
 *
 *   B. LEGACY PLACEHOLDER DETECTION — does any source file still hard-code
 *      a size-standard table? This is EXPECTED TO FAIL until Phase 3
 *      removes src/lib/score/eligibility/sbaSizeStandards.ts.
 *
 * Both are reported every run so Phase 1 completion can be judged on (A)
 * alone. The guard still exits non-zero while either fails — the exit code
 * is not softened, because a green CI signal must continue to mean "no
 * placeholder table anywhere".
 */
const artifactFailures = [];
const placeholderFailures = [];
const notes = [];

/**
 * Heuristic for "somebody hand-wrote a size-standard table in source".
 * Looks for a file that pairs NAICS-code-like literals with threshold-like
 * keys. Tuned to catch the shape of the old placeholder without flagging
 * legitimate single-code references or test fixtures.
 */
const THRESHOLD_KEY = /\b(threshold|sizeStandard|size_standard|receiptsMillions|employees)\s*:/;
const NAICS_LITERAL = /["'`]\d{6}["'`]/g;
const INLINE_TABLE_MIN_CODES = 5;

/** Files legitimately allowed to contain NAICS literals alongside thresholds. */
const ALLOWLIST = [
  // Pure parser/validator/loader tests and fixtures operate on real shapes.
  "src/lib/reference/sba/__tests__/",
  "src/lib/reference/sba/__fixtures__/",
  // Eligibility tests assert behaviour for specific known codes.
  "src/lib/score/__tests__/",
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

// ─── Checks 1-3: the generated artifact ──────────────────────────────────

let dataset = null;

if (!fs.existsSync(DATASET)) {
  artifactFailures.push(
    `NOT_GENERATED: ${relative(DATASET)} does not exist. Generate it with ` +
      `\`pnpm reference:build:sba\` from an environment with network access to ` +
      `the official SBA source, then commit the artifact and manifest.`,
  );
} else {
  try {
    dataset = JSON.parse(fs.readFileSync(DATASET, "utf8"));
  } catch (error) {
    artifactFailures.push(`UNPARSEABLE: ${relative(DATASET)} is not valid JSON — ${error.message}`);
  }
}

if (dataset) {
  // Reuse the runtime validator via tsx so the guard and production agree.
  // Shelling out (rather than importing) because this guard is plain .mjs.
  const validation = spawnSync(
    "npx",
    ["tsx", "scripts/reference-data/validate-artifact.ts"],
    { cwd: ROOT, encoding: "utf8" },
  );

  if (validation.error || validation.status === null) {
    artifactFailures.push(
      `VALIDATOR_UNAVAILABLE: could not run the dataset validator ` +
        `(${validation.error?.message ?? "no exit status"}). Refusing to pass on ` +
        `hash checks alone — the guard must verify what production verifies.`,
    );
  } else {
    for (const line of (validation.stdout ?? "").trim().split("\n")) {
      if (!line) continue;
      const [severity, code, ...rest] = line.split("|");
      if (severity === "ERROR") {
        artifactFailures.push(`INVALID_DATASET: [${code}] ${rest.join("|")}`);
      } else if (severity === "WARNING") {
        notes.push(`[${code}] ${rest.join("|")}`);
      }
    }
  }

  if (!fs.existsSync(MANIFEST)) {
    artifactFailures.push(`MISSING_MANIFEST: ${relative(MANIFEST)} does not exist`);
  } else {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    const recordsSha = crypto
      .createHash("sha256")
      .update(JSON.stringify(dataset.records))
      .digest("hex");

    if (manifest.recordsSha256 !== recordsSha) {
      artifactFailures.push(
        `HASH_MISMATCH: dataset records hash ${recordsSha.slice(0, 12)}… does not ` +
          `match manifest ${String(manifest.recordsSha256).slice(0, 12)}…. The artifact ` +
          `was edited after generation — regenerate it from source instead.`,
      );
    }

    for (const key of Object.keys(manifest.counts ?? {})) {
      if (dataset.counts?.[key] !== manifest.counts[key]) {
        artifactFailures.push(
          `COUNTS_DRIFT: counts.${key} is ${dataset.counts?.[key]} in the dataset ` +
            `but ${manifest.counts[key]} in the manifest`,
        );
      }
    }
  }
}

// ─── Check 4: no inline size-standard tables anywhere in src/ ────────────

for (const file of walk(SRC)) {
  const rel = relative(file);
  if (ALLOWLIST.some((prefix) => rel.startsWith(prefix))) continue;

  const text = fs.readFileSync(file, "utf8");
  if (!THRESHOLD_KEY.test(text)) continue;

  const codes = new Set(text.match(NAICS_LITERAL) ?? []);
  if (codes.size >= INLINE_TABLE_MIN_CODES) {
    placeholderFailures.push(
      `INLINE_TABLE: ${rel} appears to hard-code a size-standard table ` +
        `(${codes.size} NAICS literals alongside threshold keys). SBA size standards ` +
        `must come from the generated artifact in data/reference/, never from source.`,
    );
  }
}

// ─── Report ──────────────────────────────────────────────────────────────

const summary = dataset
  ? `${dataset.counts.uniqueNaics} unique NAICS, ${dataset.counts.totalRows} rows, ` +
    `${dataset.counts.baseRows} base + ${dataset.counts.exceptionRows} exception, ` +
    `effective ${dataset.effectiveDate}`
  : "no dataset generated";

console.log("── A. ARTIFACT VALIDATION ──");
if (artifactFailures.length === 0) {
  console.log(`✅ PASS (${summary})`);
} else {
  console.log(`❌ FAIL (${artifactFailures.length} issue(s))`);
  for (const failure of artifactFailures) console.log(`   - ${failure}`);
}
for (const note of notes) console.log(`   note: ${note}`);

console.log("\n── B. LEGACY PLACEHOLDER DETECTION ──");
if (placeholderFailures.length === 0) {
  console.log("✅ PASS (no hard-coded size-standard table under src/)");
} else {
  console.log(
    `❌ FAIL (${placeholderFailures.length}) — EXPECTED until Phase 3 removes the ` +
      `placeholder; not a Phase 1 defect`,
  );
  for (const failure of placeholderFailures) console.log(`   - ${failure}`);
}

if (artifactFailures.length > 0 || placeholderFailures.length > 0) {
  console.error("\nguard-reference-dataset-coverage: FAILED");
  process.exit(1);
}

console.log("\n✅ guard-reference-dataset-coverage passed.");
