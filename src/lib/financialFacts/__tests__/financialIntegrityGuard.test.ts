/**
 * Financial Integrity Hardening — CI Guards 37-41
 *
 * Phase 1A: Fact identity hash existence + uniqueness
 * Phase 2A: FACT_LINEAGE_INCOMPLETE in HARD_BLOCKER_CODES
 * Phase 4:  Fact versioning (fact_version + is_superseded columns)
 * Phase 5:  Balance sheet reconciliation guard
 * Phase 6:  Material drift threshold + event emission
 *
 * Pure-module guards — imports only from pure/CI-safe modules.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  computePreflightBlockers,
  HARD_BLOCKER_CODES,
} from "@/lib/spreads/preflight/computePreflightBlockers";
import type { PreflightInput } from "@/lib/spreads/preflight/types";
import {
  validateBalanceSheet,
  BS_BALANCE_TOLERANCE,
} from "@/lib/spreads/preflight/validateExtractedFinancials";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    intakePhase: "CONFIRMED_READY_FOR_PROCESSING",
    storedSnapshotHash: "test-hash",
    activeDocs: [],
    extractionHeartbeatDocIds: new Set<string>(),
    spreadsEnabled: true,
    visibleFactCount: 5,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Guard 37: Fact identity hash — unique index exists in migration
// ══════════════════════════════════════════════════════════════════════════

test("[guard-37a] Migration declares unique_fact_identity index", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../../supabase/migrations/20260304_financial_integrity_hardening.sql"),
    "utf-8",
  );
  assert.ok(
    src.includes("CREATE UNIQUE INDEX IF NOT EXISTS unique_fact_identity"),
    "Guard 37a: Migration must declare unique_fact_identity index",
  );
  assert.ok(
    src.includes("ON deal_financial_facts(fact_identity_hash)"),
    "Guard 37a: Index must be on deal_financial_facts(fact_identity_hash)",
  );
});

test("[guard-37b] writeFact.ts computes fact_identity_hash", () => {
  const src = readFileSync(
    resolve(__dirname, "../writeFact.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("computeFactIdentityHash"),
    "Guard 37b: writeFact.ts must call computeFactIdentityHash",
  );
  assert.ok(
    src.includes("fact_identity_hash: identityHash"),
    "Guard 37b: writeFact.ts must include fact_identity_hash in upsert row",
  );
});

test("[guard-37c] compute_fact_identity_hash SQL function uses same algorithm", () => {
  const sql = readFileSync(
    resolve(__dirname, "../../../../supabase/migrations/20260304_financial_integrity_hardening.sql"),
    "utf-8",
  );
  const ts = readFileSync(
    resolve(__dirname, "../writeFact.ts"),
    "utf-8",
  );
  // Both must use sha256 + the same pipe-delimited concatenation order
  assert.ok(sql.includes("sha256"), "Guard 37c: SQL must use sha256");
  assert.ok(ts.includes('createHash("sha256")'), "Guard 37c: TS must use createHash(sha256)");
  // Both must join 6 fields with |
  assert.ok(sql.includes("|| '|' ||"), "Guard 37c: SQL must use pipe delimiter");
  assert.ok(ts.includes('.join("|")'), "Guard 37c: TS must use pipe delimiter via join");
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 38: FACT_LINEAGE_INCOMPLETE is a hard blocker
// ══════════════════════════════════════════════════════════════════════════

test("[guard-38a] FACT_LINEAGE_INCOMPLETE is in HARD_BLOCKER_CODES", () => {
  assert.ok(
    HARD_BLOCKER_CODES.has("FACT_LINEAGE_INCOMPLETE"),
    "Guard 38a: FACT_LINEAGE_INCOMPLETE must be a hard blocker",
  );
});

test("[guard-38b] factLineageComplete=false produces FACT_LINEAGE_INCOMPLETE blocker", () => {
  const blockers = computePreflightBlockers(
    makeInput({ factLineageComplete: false }),
  );
  const blocker = blockers.find((b) => b.code === "FACT_LINEAGE_INCOMPLETE");
  assert.ok(blocker, "Guard 38b: factLineageComplete=false must produce FACT_LINEAGE_INCOMPLETE");
});

test("[guard-38c] factLineageComplete=true does NOT produce FACT_LINEAGE_INCOMPLETE", () => {
  const blockers = computePreflightBlockers(
    makeInput({ factLineageComplete: true }),
  );
  const blocker = blockers.find((b) => b.code === "FACT_LINEAGE_INCOMPLETE");
  assert.ok(!blocker, "Guard 38c: factLineageComplete=true must NOT produce FACT_LINEAGE_INCOMPLETE");
});

test("[guard-38d] factLineageComplete=undefined skips FACT_LINEAGE_INCOMPLETE (backward compat)", () => {
  const blockers = computePreflightBlockers(
    makeInput({ factLineageComplete: undefined }),
  );
  const blocker = blockers.find((b) => b.code === "FACT_LINEAGE_INCOMPLETE");
  assert.ok(!blocker, "Guard 38d: undefined factLineageComplete must skip FACT_LINEAGE_INCOMPLETE check");
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 39: Fact versioning columns exist in migration
// ══════════════════════════════════════════════════════════════════════════

test("[guard-39a] Migration adds fact_version column", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../../supabase/migrations/20260304_financial_integrity_hardening.sql"),
    "utf-8",
  );
  assert.ok(
    src.includes("ADD COLUMN IF NOT EXISTS fact_version uuid"),
    "Guard 39a: Migration must add fact_version uuid column",
  );
});

test("[guard-39b] Migration adds is_superseded column", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../../supabase/migrations/20260304_financial_integrity_hardening.sql"),
    "utf-8",
  );
  assert.ok(
    src.includes("ADD COLUMN IF NOT EXISTS is_superseded boolean"),
    "Guard 39b: Migration must add is_superseded boolean column",
  );
});

test("[guard-39c] Migration adds fact_snapshot_hash to deal_spread_runs", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../../supabase/migrations/20260304_financial_integrity_hardening.sql"),
    "utf-8",
  );
  assert.ok(
    src.includes("ADD COLUMN IF NOT EXISTS fact_snapshot_hash text"),
    "Guard 39c: Migration must add fact_snapshot_hash to deal_spread_runs",
  );
});

test("[guard-39d] writeFact.ts includes is_superseded in upsert row", () => {
  const src = readFileSync(
    resolve(__dirname, "../writeFact.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("is_superseded: false"),
    "Guard 39d: writeFact.ts must set is_superseded to false on upsert (current fact)",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 40: Balance sheet reconciliation
// ══════════════════════════════════════════════════════════════════════════

test("[guard-40a] BS_BALANCE_TOLERANCE is 0.05 (5%)", () => {
  assert.equal(
    BS_BALANCE_TOLERANCE,
    0.05,
    "Guard 40a: BS_BALANCE_TOLERANCE must be 5%",
  );
});

test("[guard-40b] Balanced BS → PASSED", () => {
  const result = validateBalanceSheet([
    { fact_key: "TOTAL_ASSETS", fact_value_num: 1_000_000, fact_value_text: null, fact_type: "BALANCE_SHEET" },
    { fact_key: "TOTAL_LIABILITIES", fact_value_num: 600_000, fact_value_text: null, fact_type: "BALANCE_SHEET" },
    { fact_key: "NET_WORTH", fact_value_num: 400_000, fact_value_text: null, fact_type: "BALANCE_SHEET" },
  ]);
  assert.equal(result.status, "PASSED", "Guard 40b: Balanced BS must PASS");
});

test("[guard-40c] Imbalanced BS → SUSPECT with BS_IMBALANCE", () => {
  const result = validateBalanceSheet([
    { fact_key: "TOTAL_ASSETS", fact_value_num: 1_000_000, fact_value_text: null, fact_type: "BALANCE_SHEET" },
    { fact_key: "TOTAL_LIABILITIES", fact_value_num: 200_000, fact_value_text: null, fact_type: "BALANCE_SHEET" },
    { fact_key: "NET_WORTH", fact_value_num: 300_000, fact_value_text: null, fact_type: "BALANCE_SHEET" },
  ]);
  // 1M vs 500K = 50% off
  assert.equal(result.status, "SUSPECT", "Guard 40c: Imbalanced BS must be SUSPECT");
  assert.equal(result.reason_code, "BS_IMBALANCE", "Guard 40c: reason_code must be BS_IMBALANCE");
});

test("[guard-40d] Migration adds reconciliation_status column", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../../supabase/migrations/20260304_financial_integrity_hardening.sql"),
    "utf-8",
  );
  assert.ok(
    src.includes("ADD COLUMN IF NOT EXISTS reconciliation_status text"),
    "Guard 40d: Migration must add reconciliation_status column",
  );
});

test("[guard-40e] extractFactsFromDocument stamps reconciliation_status", () => {
  const src = readFileSync(
    resolve(__dirname, "../../financialSpreads/extractFactsFromDocument.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("reconciliation_status"),
    "Guard 40e: extractFactsFromDocument must stamp reconciliation_status on BS facts",
  );
  assert.ok(
    src.includes('"BALANCED"') || src.includes("'BALANCED'"),
    "Guard 40e: extractFactsFromDocument must use 'BALANCED' status value",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 41: Material drift detection + no direct INSERT outside pipeline
// ══════════════════════════════════════════════════════════════════════════

test("[guard-41a] writeFact.ts defines MATERIAL_DRIFT_THRESHOLD", () => {
  const src = readFileSync(
    resolve(__dirname, "../writeFact.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("MATERIAL_DRIFT_THRESHOLD"),
    "Guard 41a: writeFact.ts must export MATERIAL_DRIFT_THRESHOLD",
  );
  assert.ok(
    src.includes("0.10"),
    "Guard 41a: MATERIAL_DRIFT_THRESHOLD must be 0.10 (10%)",
  );
});

test("[guard-41b] writeFact.ts detects and records drift", () => {
  const src = readFileSync(
    resolve(__dirname, "../writeFact.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("drift_pct"),
    "Guard 41b: writeFact.ts must compute drift_pct",
  );
  assert.ok(
    src.includes("prior_value_num"),
    "Guard 41b: writeFact.ts must track prior_value_num",
  );
});

test("[guard-41c] writeFact.ts emits material drift event", () => {
  const src = readFileSync(
    resolve(__dirname, "../writeFact.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("fact.material_drift_detected"),
    "Guard 41c: writeFact.ts must emit fact.material_drift_detected event",
  );
});

test("[guard-41d] Migration adds drift columns to deal_financial_facts", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../../supabase/migrations/20260304_financial_integrity_hardening.sql"),
    "utf-8",
  );
  assert.ok(
    src.includes("ADD COLUMN IF NOT EXISTS prior_value_num numeric"),
    "Guard 41d: Migration must add prior_value_num column",
  );
  assert.ok(
    src.includes("ADD COLUMN IF NOT EXISTS drift_pct numeric"),
    "Guard 41d: Migration must add drift_pct column",
  );
});

test("[guard-41e] Phase 1B: fact_requires_document constraint exists", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../../supabase/migrations/20260304_financial_integrity_hardening.sql"),
    "utf-8",
  );
  assert.ok(
    src.includes("ADD CONSTRAINT fact_requires_document"),
    "Guard 41e: Migration must enforce fact_requires_document NOT NULL constraint",
  );
});

test("[guard-41f] Phase 2B: Entity isolation constraints exist", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../../supabase/migrations/20260304_financial_integrity_hardening.sql"),
    "utf-8",
  );
  assert.ok(
    src.includes("ADD CONSTRAINT fact_requires_owner_type"),
    "Guard 41f: Migration must enforce fact_requires_owner_type constraint",
  );
  assert.ok(
    src.includes("ADD CONSTRAINT fact_requires_entity"),
    "Guard 41f: Migration must enforce fact_requires_entity constraint",
  );
});

test("[guard-41g] Phase 3: Spread run idempotency index exists", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../../supabase/migrations/20260304_financial_integrity_hardening.sql"),
    "utf-8",
  );
  assert.ok(
    src.includes("CREATE UNIQUE INDEX IF NOT EXISTS unique_active_spread_run"),
    "Guard 41g: Migration must create unique_active_spread_run index",
  );
  assert.ok(
    src.includes("deal_spread_runs(deal_id, run_reason"),
    "Guard 41g: Index must cover (deal_id, run_reason, date)",
  );
});
