/**
 * Canonical Credit Memo Guards
 *
 * Invariants enforced:
 *   1. Override policy: computed fields are NEVER permitted
 *   2. Override policy: qualitative narrative keys ARE permitted
 *   3. Memo builder: all numerics come from canonical snapshot/facts/pricing
 *   4. Memo builder: overrides are used ONLY for narrative fields
 *   5. Memo provenance: input hash is deterministic
 *   6. Memo provenance: staleness detection works correctly
 *   7. Packet generator: references canonical memo and financial validation
 *   8. Observability: typed event helpers exist and export correctly
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  isPermittedOverrideKey,
  filterQualitativeOverrides,
  PERMITTED_OVERRIDE_KEYS,
} from "@/lib/creditMemo/overridePolicy";

import {
  computeMemoInputHash,
  checkMemoStaleness,
  buildProvenanceManifest,
  COMPUTED_MEMO_FIELDS,
  QUALITATIVE_MEMO_FIELDS,
} from "@/lib/creditMemo/canonical/memoProvenance";

// ══════════════════════════════════════════════════════════════════════════
// Guard 1: Override policy — computed fields are NEVER permitted
// ══════════════════════════════════════════════════════════════════════════

test("[guard-1a] DSCR key is forbidden in overrides", () => {
  assert.equal(isPermittedOverrideKey("dscr"), false);
  assert.equal(isPermittedOverrideKey("dscr_global"), false);
  assert.equal(isPermittedOverrideKey("dscr_stressed"), false);
});

test("[guard-1b] LTV/LTC keys are forbidden in overrides", () => {
  assert.equal(isPermittedOverrideKey("ltv"), false);
  assert.equal(isPermittedOverrideKey("ltv_gross"), false);
  assert.equal(isPermittedOverrideKey("ltc"), false);
});

test("[guard-1c] Revenue/EBITDA/NOI keys are forbidden in overrides", () => {
  assert.equal(isPermittedOverrideKey("revenue"), false);
  assert.equal(isPermittedOverrideKey("ebitda"), false);
  assert.equal(isPermittedOverrideKey("noi"), false);
  assert.equal(isPermittedOverrideKey("net_income"), false);
});

test("[guard-1d] Loan amount / collateral value keys are forbidden", () => {
  assert.equal(isPermittedOverrideKey("loan_amount"), false);
  assert.equal(isPermittedOverrideKey("collateral_value"), false);
  assert.equal(isPermittedOverrideKey("appraised_value"), false);
});

test("[guard-1e] Debt service / yield / ratio keys are forbidden", () => {
  assert.equal(isPermittedOverrideKey("debt_service"), false);
  assert.equal(isPermittedOverrideKey("yield"), false);
  assert.equal(isPermittedOverrideKey("ratio"), false);
  assert.equal(isPermittedOverrideKey("cap_rate"), false);
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 2: Override policy — qualitative narrative keys ARE permitted
// ══════════════════════════════════════════════════════════════════════════

test("[guard-2a] Business narrative keys are permitted", () => {
  assert.equal(isPermittedOverrideKey("business_description"), true);
  assert.equal(isPermittedOverrideKey("company_history"), true);
  assert.equal(isPermittedOverrideKey("competitive_position"), true);
});

test("[guard-2b] Management/principal keys are permitted", () => {
  assert.equal(isPermittedOverrideKey("management_assessment"), true);
  assert.equal(isPermittedOverrideKey("principal_bio_abc123"), true);
  assert.equal(isPermittedOverrideKey("principal_name_xyz"), true);
});

test("[guard-2c] Risk narrative keys are permitted", () => {
  assert.equal(isPermittedOverrideKey("risk_mitigants"), true);
  assert.equal(isPermittedOverrideKey("strengths"), true);
  assert.equal(isPermittedOverrideKey("weaknesses"), true);
});

test("[guard-2d] Business detail qualitative keys are permitted", () => {
  assert.equal(isPermittedOverrideKey("revenue_mix"), true);
  assert.equal(isPermittedOverrideKey("seasonality"), true);
});

test("[guard-2e] Builder story mapped keys are permitted", () => {
  assert.equal(isPermittedOverrideKey("principal_background"), true);
  assert.equal(isPermittedOverrideKey("key_weaknesses"), true);
  assert.equal(isPermittedOverrideKey("key_strengths"), true);
});

test("[guard-2f] Unknown keys are rejected by default (fail-safe)", () => {
  assert.equal(isPermittedOverrideKey("some_random_key"), false);
  assert.equal(isPermittedOverrideKey(""), false);
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 3: filterQualitativeOverrides separates accepted from rejected
// ══════════════════════════════════════════════════════════════════════════

test("[guard-3a] filterQualitativeOverrides accepts narrative, rejects numeric", () => {
  const { accepted, rejected } = filterQualitativeOverrides({
    business_description: "A description",
    dscr: 1.25,
    strengths: "Strong borrower",
    ltv: 0.75,
  });
  assert.equal(Object.keys(accepted).length, 2);
  assert.ok("business_description" in accepted);
  assert.ok("strengths" in accepted);
  assert.equal(rejected.length, 2);
  assert.ok(rejected.includes("dscr"));
  assert.ok(rejected.includes("ltv"));
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 4: Memo builder sources numerics from canonical snapshot, NOT overrides
// ══════════════════════════════════════════════════════════════════════════

test("[guard-4a] buildCanonicalCreditMemo uses metricValueFromSnapshot for financial metrics", () => {
  const src = readFileSync(
    resolve(__dirname, "../canonical/buildCanonicalCreditMemo.ts"),
    "utf-8",
  );
  // All key financial metrics must come from snapshot
  assert.ok(src.includes('metricValueFromSnapshot({ snapshot, metric: "cash_flow_available"'), "cash_flow_available must come from snapshot");
  assert.ok(src.includes('metricValueFromSnapshot({ snapshot, metric: "annual_debt_service"'), "annual_debt_service must come from snapshot");
  assert.ok(src.includes('metricValueFromSnapshot({ snapshot, metric: "dscr"'), "dscr must come from snapshot");
  assert.ok(src.includes('metricValueFromSnapshot({ snapshot, metric: "noi_ttm"'), "noi_ttm must come from snapshot");
});

test("[guard-4b] buildCanonicalCreditMemo uses overrides ONLY for narrative fields", () => {
  const src = readFileSync(
    resolve(__dirname, "../canonical/buildCanonicalCreditMemo.ts"),
    "utf-8",
  );
  // Find all override property reads: overrides.xxx or overrides[xxx]
  const overrideReads = src.match(/overrides\.\w+|overrides\["[^"]+"\]/g) ?? [];
  // These fields are narrative-only and have no canonical snapshot source;
  // safe to source from overrides.
  const narrativeKeys = [
    "collateral_description", "business_description",
    "revenue_mix", "seasonality", "principal_bio_",
    "competitive_advantages", "vision",
  ];

  for (const read of overrideReads) {
    const matchesNarrative = narrativeKeys.some((k) => read.includes(k));
    assert.ok(
      matchesNarrative,
      `Override read "${read}" must be for a narrative field, not computed`,
    );
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 5: Memo provenance — input hash is deterministic
// ══════════════════════════════════════════════════════════════════════════

test("[guard-5a] computeMemoInputHash is deterministic for same inputs", () => {
  const inputs = {
    snapshotId: "snap-123",
    snapshotUpdatedAt: "2026-04-01T00:00:00Z",
    pricingDecisionId: "price-456",
    pricingUpdatedAt: "2026-04-01T00:00:00Z",
    factCount: 42,
    latestFactUpdatedAt: "2026-04-01T00:00:00Z",
  };
  const hash1 = computeMemoInputHash(inputs);
  const hash2 = computeMemoInputHash(inputs);
  assert.equal(hash1, hash2, "Same inputs must produce same hash");
});

test("[guard-5b] computeMemoInputHash changes when snapshot changes", () => {
  const base = {
    snapshotId: "snap-123",
    snapshotUpdatedAt: "2026-04-01T00:00:00Z",
    pricingDecisionId: "price-456",
    pricingUpdatedAt: "2026-04-01T00:00:00Z",
    factCount: 42,
    latestFactUpdatedAt: "2026-04-01T00:00:00Z",
  };
  const hash1 = computeMemoInputHash(base);
  const hash2 = computeMemoInputHash({ ...base, snapshotId: "snap-789" });
  assert.notEqual(hash1, hash2, "Different snapshot must produce different hash");
});

test("[guard-5c] computeMemoInputHash changes when fact count changes", () => {
  const base = {
    snapshotId: "snap-123",
    snapshotUpdatedAt: "2026-04-01T00:00:00Z",
    pricingDecisionId: null,
    pricingUpdatedAt: null,
    factCount: 42,
    latestFactUpdatedAt: null,
  };
  const hash1 = computeMemoInputHash(base);
  const hash2 = computeMemoInputHash({ ...base, factCount: 43 });
  assert.notEqual(hash1, hash2, "Different fact count must produce different hash");
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 6: Memo staleness detection
// ══════════════════════════════════════════════════════════════════════════

test("[guard-6a] checkMemoStaleness returns stale when no memo exists", () => {
  const result = checkMemoStaleness("abc123", null);
  assert.equal(result.stale, true);
  assert.ok(result.reasons.length > 0);
});

test("[guard-6b] checkMemoStaleness returns stale when hashes differ", () => {
  const result = checkMemoStaleness("abc123", "xyz789");
  assert.equal(result.stale, true);
});

test("[guard-6c] checkMemoStaleness returns not stale when hashes match", () => {
  const result = checkMemoStaleness("abc123", "abc123");
  assert.equal(result.stale, false);
  assert.equal(result.reasons.length, 0);
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 7: Provenance manifest builder
// ══════════════════════════════════════════════════════════════════════════

test("[guard-7a] buildProvenanceManifest produces correct field counts", () => {
  const manifest = buildProvenanceManifest(
    "deal-123",
    "hash-abc",
    [
      { field: "dscr_global", value: 1.25, updatedAt: "2026-04-01" },
      { field: "ltv_gross", value: 0.72, updatedAt: "2026-04-01" },
    ],
    [
      { field: "business_description", value: "A company" },
    ],
  );
  assert.equal(manifest.version, "provenance_v1");
  assert.equal(manifest.computedFieldCount, 2);
  assert.equal(manifest.qualitativeFieldCount, 1);
  assert.equal(manifest.fields.length, 3);
});

test("[guard-7b] COMPUTED_MEMO_FIELDS registry has entries", () => {
  assert.ok(COMPUTED_MEMO_FIELDS.length >= 25, "Must have at least 25 computed field definitions");
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 8: Packet generator references canonical memo and financial validation
// ══════════════════════════════════════════════════════════════════════════

test("[guard-8a] Packet generator imports buildCommitteeFinancialValidationSummary", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../app/api/deals/[dealId]/committee/packet/generate/route.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("buildCommitteeFinancialValidationSummary"),
    "Packet generator must import financial validation summary builder",
  );
});

test("[guard-8b] Packet generator fetches canonical_memo_narratives", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../app/api/deals/[dealId]/committee/packet/generate/route.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("canonical_memo_narratives"),
    "Packet generator must reference canonical memo narratives",
  );
});

test("[guard-8c] Packet generator includes financial validation in event metadata", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../app/api/deals/[dealId]/committee/packet/generate/route.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("financialValidationStatus") || src.includes("financialValidationDecisionSafe"),
    "Packet event must include financial validation state",
  );
});

test("[guard-8d] Packet generator includes memo input hash in event metadata", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../app/api/deals/[dealId]/committee/packet/generate/route.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("memoInputHash"),
    "Packet event must include memo input hash for traceability",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 9: Override policy enforcement in API routes
// ══════════════════════════════════════════════════════════════════════════

test("[guard-9a] memo-overrides PATCH route enforces isPermittedOverrideKey", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../app/api/deals/[dealId]/memo-overrides/route.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("isPermittedOverrideKey"),
    "memo-overrides PATCH must enforce override policy",
  );
});

test("[guard-9b] credit-memo/overrides POST is a SPEC-13 deprecation shim", () => {
  // SPEC-13: the POST handler no longer writes to deal_memo_overrides;
  // the wizard's writes go through POST /api/deals/[dealId]/memo-inputs with
  // body { kind: "from-wizard", overrides } (consolidated dispatcher), which
  // targets the canonical deal_borrower_story / deal_management_profiles
  // tables. The legacy POST is preserved as a no-op for one deploy
  // cycle so older clients don't error out.
  const src = readFileSync(
    resolve(__dirname, "../../../app/api/deals/[dealId]/credit-memo/overrides/route.ts"),
    "utf-8",
  );
  assert.match(
    src,
    /deprecated:\s*true/,
    "POST must return { deprecated: true } so callers can migrate",
  );
  assert.match(
    src,
    /memo-inputs/,
    "POST must point callers at the SPEC-13 successor route (memo-inputs)",
  );
  assert.match(
    src,
    /kind:\s*"from-wizard"/,
    "POST shim's docstring must record the new wizard kind discriminator",
  );
  assert.ok(
    !src.includes("filterQualitativeOverrides"),
    "POST shim must not invoke the legacy override filter — no writes happen",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 10: Observability event helpers exist
// ══════════════════════════════════════════════════════════════════════════

test("[guard-10a] Observability event helpers module exists", () => {
  const src = readFileSync(
    resolve(__dirname, "../../observability/underwriteEvents.ts"),
    "utf-8",
  );
  assert.ok(src.includes("emitMemoGenerationRequested"), "Must export emitMemoGenerationRequested");
  assert.ok(src.includes("emitMemoStaleDetected"), "Must export emitMemoStaleDetected");
  assert.ok(src.includes("emitMemoOverrideSaved"), "Must export emitMemoOverrideSaved");
  assert.ok(src.includes("emitPacketPreflightBlocked"), "Must export emitPacketPreflightBlocked");
  assert.ok(src.includes("emitDecisionReadinessBlocked"), "Must export emitDecisionReadinessBlocked");
  assert.ok(src.includes("emitUnderwriteSnapshotDrift"), "Must export emitUnderwriteSnapshotDrift");
  assert.ok(src.includes("emitBankerActionExecuted"), "Must export emitBankerActionExecuted");
});

test("[guard-10b] Memo generation route emits observability events", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../app/api/deals/[dealId]/credit-memo/generate/route.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("memo.generation.completed"),
    "Memo generate route must emit memo.generation.completed event",
  );
  assert.ok(
    src.includes("memo.generation.failed"),
    "Memo generate route must emit memo.generation.failed event",
  );
});

test("[guard-10c] Packet generation route emits observability events", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../app/api/deals/[dealId]/committee/packet/generate/route.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("packet.generation.completed"),
    "Packet generate route must emit packet.generation.completed event",
  );
  assert.ok(
    src.includes("packet.generation.failed"),
    "Packet generate route must emit packet.generation.failed event",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// Guard 11: No duplicate memo/packet truth layer
// ══════════════════════════════════════════════════════════════════════════

test("[guard-11a] Packet generator does NOT embed financial calculations", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../app/api/deals/[dealId]/committee/packet/generate/route.ts"),
    "utf-8",
  );
  // Packet must NOT have inline DSCR/LTV/NOI calculations
  assert.ok(!src.includes("Math."), "Packet must not do inline math calculations");
  assert.ok(
    !(/dscr\s*[:=]\s*[^"']/.test(src)),
    "Packet must not compute DSCR inline",
  );
});

test("[guard-11b] Memo generate route uses computeMemoInputHash for provenance", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../app/api/deals/[dealId]/credit-memo/generate/route.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("computeMemoInputHash"),
    "Memo generate route must use canonical provenance hash, not ad hoc hashing",
  );
});
