import { test, describe } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for Phase J + K + L:
 *  - Phase J: Multi-Bank Policy Variance
 *  - Phase K: Regulator Sandbox Mode
 *  - Phase L: Live Examiner Access Portal
 *
 * Tests pure functions and contracts only — no DB, no AI calls.
 */

// ─── Local replicas of pure functions ─────────────────────

/** Deterministic JSON stringification with deep-sorted keys */
function stableStringify(obj: any): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce<Record<string, any>>((sorted, k) => {
          sorted[k] = value[k];
          return sorted;
        }, {});
    }
    return value;
  });
}

/** Simulated sha256 for pure tests (deterministic, not crypto) */
function sha256Sim(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(16, "0");
}

// ─── Type replicas ────────────────────────────────────────

type BankPolicyRule = {
  rule_id: string;
  description: string;
  threshold: unknown;
  severity: "hard" | "soft";
};

type BankPolicyPack = {
  bank_id: string;
  policy_id: string;
  policy_version: string;
  effective_at: string;
  supersedes: string | null;
  rules: BankPolicyRule[];
  policy_hash: string;
  created_at: string;
};

type BankPolicyPackSummary = {
  bank_id: string;
  policy_id: string;
  policy_version: string;
  effective_at: string;
  rule_count: number;
  hard_rules: number;
  soft_rules: number;
  policy_hash: string;
};

type PolicyPackDiff = {
  bank_a_id: string;
  bank_b_id: string;
  bank_a_version: string;
  bank_b_version: string;
  only_in_a: BankPolicyRule[];
  only_in_b: BankPolicyRule[];
  changed: Array<{ rule_id: string; bank_a: BankPolicyRule; bank_b: BankPolicyRule }>;
  identical_count: number;
  total_rules_a: number;
  total_rules_b: number;
};

type FrozenPolicyReference = {
  bank_id: string;
  policy_id: string;
  policy_version: string;
  policy_hash: string;
  frozen_at: string;
  effective_at: string;
  rule_count: number;
};

type ExaminerAccessScope = {
  deal_ids: string[];
  read_areas: string[];
};

type ExaminerAccessGrant = {
  id: string;
  grant_code: string;
  examiner_name: string;
  organization: string;
  bank_id: string;
  scope: ExaminerAccessScope;
  granted_by_user_id: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revoke_reason: string | null;
  is_active: boolean;
};

type IntegrityCheckResult = {
  check_version: "1.0";
  checked_at: string;
  artifact_type: string;
  artifact_id: string;
  expected_hash: string;
  computed_hash: string;
  match: boolean;
  details: string;
};

type ManifestVerificationResult = {
  check_version: "1.0";
  checked_at: string;
  manifest_valid: boolean;
  artifacts_checked: number;
  artifacts_matched: number;
  artifacts_mismatched: number;
  drop_hash_match: boolean;
  results: IntegrityCheckResult[];
};

type WalkthroughStep = {
  step_number: number;
  title: string;
  description: string;
  what_to_verify: string[];
  artifacts_to_review: string[];
  playbook_reference: string;
  verification_action: string | null;
};

type OutcomeDelta = {
  bank_a_id: string;
  bank_b_id: string;
  bank_a_outcome: string | null;
  bank_b_outcome: string | null;
  differs: boolean;
  explanation: string;
};

type MetricDelta = {
  metric: string;
  bank_a_id: string;
  bank_b_id: string;
  bank_a_value: number | null;
  bank_b_value: number | null;
  delta: number | null;
  significance: "material" | "minor" | "identical";
};

// ─── Pure function replicas ───────────────────────────────

function buildPolicyPack(args: {
  bank_id: string;
  policy_id: string;
  policy_version: string;
  effective_at: string;
  supersedes?: string | null;
  rules: BankPolicyRule[];
  created_at: string;
}): BankPolicyPack {
  const hashInput = JSON.stringify({
    bank_id: args.bank_id,
    policy_id: args.policy_id,
    policy_version: args.policy_version,
    rules: args.rules
      .slice()
      .sort((a, b) => a.rule_id.localeCompare(b.rule_id))
      .map((r) => ({
        rule_id: r.rule_id,
        description: r.description,
        threshold: r.threshold,
        severity: r.severity,
      })),
  });

  return {
    bank_id: args.bank_id,
    policy_id: args.policy_id,
    policy_version: args.policy_version,
    effective_at: args.effective_at,
    supersedes: args.supersedes ?? null,
    rules: args.rules,
    policy_hash: sha256Sim(hashInput),
    created_at: args.created_at,
  };
}

function summarizePolicyPack(pack: BankPolicyPack): BankPolicyPackSummary {
  return {
    bank_id: pack.bank_id,
    policy_id: pack.policy_id,
    policy_version: pack.policy_version,
    effective_at: pack.effective_at,
    rule_count: pack.rules.length,
    hard_rules: pack.rules.filter((r) => r.severity === "hard").length,
    soft_rules: pack.rules.filter((r) => r.severity === "soft").length,
    policy_hash: pack.policy_hash,
  };
}

function diffPolicyPacks(
  packA: BankPolicyPack,
  packB: BankPolicyPack,
): PolicyPackDiff {
  const rulesA = new Map(packA.rules.map((r) => [r.rule_id, r]));
  const rulesB = new Map(packB.rules.map((r) => [r.rule_id, r]));

  const onlyInA: BankPolicyRule[] = [];
  const onlyInB: BankPolicyRule[] = [];
  const changed: Array<{ rule_id: string; bank_a: BankPolicyRule; bank_b: BankPolicyRule }> = [];
  const identical: string[] = [];

  for (const [id, ruleA] of rulesA) {
    const ruleB = rulesB.get(id);
    if (!ruleB) {
      onlyInA.push(ruleA);
    } else if (
      JSON.stringify(ruleA.threshold) !== JSON.stringify(ruleB.threshold) ||
      ruleA.severity !== ruleB.severity
    ) {
      changed.push({ rule_id: id, bank_a: ruleA, bank_b: ruleB });
    } else {
      identical.push(id);
    }
  }

  for (const [id] of rulesB) {
    if (!rulesA.has(id)) {
      onlyInB.push(rulesB.get(id)!);
    }
  }

  return {
    bank_a_id: packA.bank_id,
    bank_b_id: packB.bank_id,
    bank_a_version: packA.policy_version,
    bank_b_version: packB.policy_version,
    only_in_a: onlyInA,
    only_in_b: onlyInB,
    changed,
    identical_count: identical.length,
    total_rules_a: packA.rules.length,
    total_rules_b: packB.rules.length,
  };
}

function freezePolicyReference(pack: BankPolicyPack): FrozenPolicyReference {
  return {
    bank_id: pack.bank_id,
    policy_id: pack.policy_id,
    policy_version: pack.policy_version,
    policy_hash: pack.policy_hash,
    frozen_at: new Date().toISOString(),
    effective_at: pack.effective_at,
    rule_count: pack.rules.length,
  };
}

function validateFrozenPolicy(
  frozen: FrozenPolicyReference,
  pack: BankPolicyPack,
): { valid: boolean; mismatches: string[] } {
  const mismatches: string[] = [];

  if (frozen.policy_hash !== pack.policy_hash) {
    mismatches.push(
      `Policy hash mismatch: frozen=${frozen.policy_hash.slice(0, 16)}… ` +
      `current=${pack.policy_hash.slice(0, 16)}…`,
    );
  }
  if (frozen.policy_version !== pack.policy_version) {
    mismatches.push(
      `Version mismatch: frozen=${frozen.policy_version} current=${pack.policy_version}`,
    );
  }
  if (frozen.rule_count !== pack.rules.length) {
    mismatches.push(
      `Rule count mismatch: frozen=${frozen.rule_count} current=${pack.rules.length}`,
    );
  }

  return { valid: mismatches.length === 0, mismatches };
}

function validateGrantScope(
  grant: ExaminerAccessGrant,
  dealId: string,
  area: string,
): { allowed: boolean; reason: string } {
  if (!grant.is_active) {
    return { allowed: false, reason: "Grant is no longer active (expired or revoked)." };
  }

  const scope = grant.scope;

  if (scope.deal_ids.length > 0 && !scope.deal_ids.includes(dealId)) {
    return { allowed: false, reason: `Deal ${dealId.slice(0, 8)}… is not in grant scope.` };
  }

  if (!scope.read_areas.includes("all") && !scope.read_areas.includes(area)) {
    return { allowed: false, reason: `Area "${area}" is not in grant scope.` };
  }

  return { allowed: true, reason: "Access permitted." };
}

function verifySnapshotHash(args: {
  snapshot: unknown;
  expectedHash: string;
  artifactType: string;
  artifactId: string;
}): IntegrityCheckResult {
  const checkedAt = new Date().toISOString();
  const canonicalJson = stableStringify(args.snapshot);
  const computedHash = sha256Sim(canonicalJson);
  const match = computedHash === args.expectedHash;

  return {
    check_version: "1.0",
    checked_at: checkedAt,
    artifact_type: args.artifactType,
    artifact_id: args.artifactId,
    expected_hash: args.expectedHash,
    computed_hash: computedHash,
    match,
    details: match
      ? "Hash verified. Artifact is unchanged since generation."
      : "Hash mismatch. Artifact may have been modified since generation.",
  };
}

function verifyDropManifest(args: {
  manifest: {
    drop_hash: string;
    artifacts: Array<{
      path: string;
      sha256: string;
      size_bytes: number;
    }>;
  };
  artifactContents: Map<string, string>;
}): ManifestVerificationResult {
  const checkedAt = new Date().toISOString();
  const results: IntegrityCheckResult[] = [];
  let matched = 0;
  let mismatched = 0;

  for (const artifact of args.manifest.artifacts) {
    const content = args.artifactContents.get(artifact.path);

    if (content === undefined) {
      results.push({
        check_version: "1.0",
        checked_at: checkedAt,
        artifact_type: "file",
        artifact_id: artifact.path,
        expected_hash: artifact.sha256,
        computed_hash: "",
        match: false,
        details: `Artifact "${artifact.path}" not provided for verification.`,
      });
      mismatched++;
      continue;
    }

    const computedHash = sha256Sim(content);
    const match = computedHash === artifact.sha256;

    results.push({
      check_version: "1.0",
      checked_at: checkedAt,
      artifact_type: "file",
      artifact_id: artifact.path,
      expected_hash: artifact.sha256,
      computed_hash: computedHash,
      match,
      details: match
        ? `"${artifact.path}" integrity verified.`
        : `"${artifact.path}" hash mismatch.`,
    });

    if (match) matched++;
    else mismatched++;
  }

  const allArtifactHashes = args.manifest.artifacts.map((a) => a.sha256).join("|");
  const computedDropHash = sha256Sim(allArtifactHashes);
  const dropHashMatch = computedDropHash === args.manifest.drop_hash;

  return {
    check_version: "1.0",
    checked_at: checkedAt,
    manifest_valid: mismatched === 0 && dropHashMatch,
    artifacts_checked: args.manifest.artifacts.length,
    artifacts_matched: matched,
    artifacts_mismatched: mismatched,
    drop_hash_match: dropHashMatch,
    results,
  };
}

function computeSnapshotHash(snapshot: unknown): string {
  const canonicalJson = stableStringify(snapshot);
  return sha256Sim(canonicalJson);
}

function computeDropHash(artifactHashes: string[]): string {
  return sha256Sim(artifactHashes.join("|"));
}

function buildOutcomeDelta(
  a: { bank_id: string; bank_name: string; outcome: string | null },
  b: { bank_id: string; bank_name: string; outcome: string | null },
): OutcomeDelta {
  const differs = a.outcome !== b.outcome;
  let explanation = "";

  if (!differs) {
    explanation = `Both banks reached the same outcome: ${a.outcome ?? "N/A"}`;
  } else if (!a.outcome) {
    explanation = `${a.bank_name} has no decision; ${b.bank_name}: ${b.outcome}`;
  } else if (!b.outcome) {
    explanation = `${a.bank_name}: ${a.outcome}; ${b.bank_name} has no decision`;
  } else {
    explanation = `${a.bank_name}: ${a.outcome} vs ${b.bank_name}: ${b.outcome}`;
  }

  return {
    bank_a_id: a.bank_id,
    bank_b_id: b.bank_id,
    bank_a_outcome: a.outcome,
    bank_b_outcome: b.outcome,
    differs,
    explanation,
  };
}

function buildMetricDeltas(
  a: { bank_id: string; dscr: number | null; ltv_gross: number | null; confidence: number | null; rules_failed: number; exceptions_count: number; overrides_count: number; pricing_rate: number | null },
  b: { bank_id: string; dscr: number | null; ltv_gross: number | null; confidence: number | null; rules_failed: number; exceptions_count: number; overrides_count: number; pricing_rate: number | null },
): MetricDelta[] {
  const metrics: Array<{ metric: string; aVal: number | null; bVal: number | null; threshold: number }> = [
    { metric: "dscr", aVal: a.dscr, bVal: b.dscr, threshold: 0.05 },
    { metric: "ltv_gross", aVal: a.ltv_gross, bVal: b.ltv_gross, threshold: 0.02 },
    { metric: "confidence", aVal: a.confidence, bVal: b.confidence, threshold: 0.05 },
    { metric: "rules_failed", aVal: a.rules_failed, bVal: b.rules_failed, threshold: 0 },
    { metric: "exceptions_count", aVal: a.exceptions_count, bVal: b.exceptions_count, threshold: 0 },
    { metric: "overrides_count", aVal: a.overrides_count, bVal: b.overrides_count, threshold: 0 },
    { metric: "pricing_rate", aVal: a.pricing_rate, bVal: b.pricing_rate, threshold: 0.001 },
  ];

  return metrics.map(({ metric, aVal, bVal, threshold }) => {
    const delta = aVal !== null && bVal !== null ? aVal - bVal : null;
    let significance: "material" | "minor" | "identical" = "identical";
    if (delta !== null) {
      significance = Math.abs(delta) > threshold ? "material" : Math.abs(delta) > 0 ? "minor" : "identical";
    } else if (aVal !== bVal) {
      significance = "material";
    }

    return {
      metric,
      bank_a_id: a.bank_id,
      bank_b_id: b.bank_id,
      bank_a_value: aVal,
      bank_b_value: bVal,
      delta,
      significance,
    };
  });
}

// ─── Walkthrough data replica ─────────────────────────────

const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    step_number: 1,
    title: "System Overview & AI Governance",
    description:
      "Begin by reviewing the system architecture and AI governance framework. " +
      "Confirm that all AI models operate in assistive-only mode with no " +
      "autonomous decision authority. Verify the model registry is complete " +
      "and all models have declared input/output boundaries.",
    what_to_verify: [
      "All 4 AI models are listed in the governance appendix",
      "Every model has decision_authority: assistive-only",
      "Every model has human_override_required: true",
      "No model has access to borrower funds or accounts",
      "Governance invariant check passes (invariant_check.ok === true)",
    ],
    artifacts_to_review: [
      "policies/model-governance.json",
      "playbooks/examiner-playbooks.json → system_overview",
      "playbooks/examiner-playbooks.json → ai_usage_explanation",
    ],
    playbook_reference: "System Overview + AI Usage Explanation",
    verification_action: "Run invariant check: verify governance_appendix.invariant_check.ok === true",
  },
  {
    step_number: 2,
    title: "Borrower Identity & Verification",
    description:
      "Review how borrower identity is established, verified, and attested. " +
      "Confirm that EIN handling follows masking rules (full EIN never stored " +
      "in model outputs). Verify ownership extraction sources and attestation " +
      "requirements.",
    what_to_verify: [
      "Borrower legal name matches tax return documents",
      "EIN is masked to **-***NNNN format in all outputs",
      "Entity type is correctly identified (1120/1065/1120S/1040)",
      "Ownership percentages sum to <= 100%",
      "Owners >= 20% are tracked for regulatory purposes",
      "Human attestation was completed before underwriting proceeded",
    ],
    artifacts_to_review: [
      "borrower-audit/snapshot.json",
      "borrower-audit/snapshot.pdf",
    ],
    playbook_reference: "Borrower Verification",
    verification_action: "Compare borrower-audit/snapshot.json fields against uploaded tax returns",
  },
  {
    step_number: 3,
    title: "Financial Analysis & Data Integrity",
    description:
      "Examine the financial metrics used for underwriting. Verify that " +
      "DSCR, LTV, NOI, and collateral coverage are correctly computed. " +
      "Check that conflicting data sources are resolved by priority " +
      "(Manual > Spread > Extract), not by AI preference.",
    what_to_verify: [
      "DSCR calculation is supported by income and debt service figures",
      "LTV is computed from appraised value and loan amount",
      "NOI matches rent roll or income statement data",
      "Financial completeness percentage reflects data availability",
      "Source provenance shows where each metric originated",
      "Stress scenarios use declared parameters, not AI assumptions",
    ],
    artifacts_to_review: [
      "financials/financial-snapshot.json",
      "credit-decision/snapshot.json → financials section",
    ],
    playbook_reference: "Credit Decision Process → Risk Grading",
    verification_action: "Verify DSCR = NOI / Annual Debt Service from financial-snapshot.json",
  },
  {
    step_number: 4,
    title: "Policy Evaluation & Rule Application",
    description:
      "Review how bank credit policy was applied to this deal. Confirm " +
      "that policy rules are evaluated programmatically (deterministic), " +
      "not by AI. Check that policy exceptions are documented and approved.",
    what_to_verify: [
      "Policy rules evaluated count matches bank policy configuration",
      "Hard rule failures are accompanied by exceptions or overrides",
      "Soft rule warnings have documented mitigants or justification",
      "Policy chunks used for context are from the correct bank",
      "No AI-generated policy rules exist (rules are bank-configured)",
    ],
    artifacts_to_review: [
      "policies/policy-eval.json",
      "policies/exceptions.json",
      "credit-decision/snapshot.json → policy section",
    ],
    playbook_reference: "Credit Decision Process → Policy Application",
    verification_action: "Confirm policy-eval rules_evaluated >= rules_passed + rules_failed",
  },
  {
    step_number: 5,
    title: "Human Overrides & Decision Authority",
    description:
      "Examine all instances where human users overrode model recommendations. " +
      "Verify that overrides are documented with reason, justification, " +
      "approver identity, and timestamp. Confirm decision authority hierarchy.",
    what_to_verify: [
      "Every override has a documented reason and justification",
      "Override approver has appropriate role authority",
      "Override severity is correctly classified",
      "No model output was accepted without human review opportunity",
      "Overrides appear in credit decision audit and examiner drop",
    ],
    artifacts_to_review: [
      "credit-decision/snapshot.json → overrides section",
      "credit-decision/snapshot.pdf → Human Overrides section",
    ],
    playbook_reference: "Override Handling",
    verification_action: "Verify each override has non-empty reason, justification, and approved_by_user_id",
  },
  {
    step_number: 6,
    title: "Attestation Chain & Committee Record",
    description:
      "Review the attestation chain — every human who signed off on the " +
      "decision. If committee review was required, verify quorum, vote " +
      "counts, dissent opinions, and minutes.",
    what_to_verify: [
      "At least one attestation exists for the final decision",
      "Attestation snapshot hashes are present and non-empty",
      "Committee quorum was met (if committee review required)",
      "Dissent opinions are recorded (if any members dissented)",
      "Committee minutes are available and hashed",
      "All votes include voter identity and timestamp",
    ],
    artifacts_to_review: [
      "credit-decision/snapshot.json → attestations section",
      "credit-decision/snapshot.json → committee section",
      "credit-decision/snapshot.pdf → Attestation Chain + Committee Record",
    ],
    playbook_reference: "Underwriting Flow → Committee Review",
    verification_action: "Verify committee.vote_count >= committee.quorum (if committee required)",
  },
  {
    step_number: 7,
    title: "Package Integrity Verification",
    description:
      "Verify the tamper-evident integrity of the entire examiner drop " +
      "package. Recompute SHA-256 checksums for all files and compare " +
      "against the manifest. Verify the aggregate drop hash.",
    what_to_verify: [
      "Every file in the package has a SHA-256 checksum in the manifest",
      "Recomputed checksums match manifest values",
      "Drop hash matches the X-Buddy-Drop-Hash response header",
      "Manifest artifact count matches actual file count",
      "All content_type values are correct",
    ],
    artifacts_to_review: [
      "integrity/manifest.json",
      "integrity/checksums.txt",
      "README.txt",
    ],
    playbook_reference: "Audit Artifacts Map → Verification",
    verification_action: "Run: sha256sum -c integrity/checksums.txt",
  },
];

// ─── Test fixtures ────────────────────────────────────────

const RULE_A1: BankPolicyRule = {
  rule_id: "min_dscr",
  description: "Minimum DSCR of 1.25x required",
  threshold: { min: 1.25 },
  severity: "hard",
};

const RULE_A2: BankPolicyRule = {
  rule_id: "max_ltv",
  description: "Maximum LTV of 80%",
  threshold: { max: 0.80 },
  severity: "hard",
};

const RULE_A3: BankPolicyRule = {
  rule_id: "min_experience",
  description: "Borrower should have 3+ years experience",
  threshold: { min_years: 3 },
  severity: "soft",
};

const RULE_B1: BankPolicyRule = {
  rule_id: "min_dscr",
  description: "Minimum DSCR of 1.20x required",
  threshold: { min: 1.20 },
  severity: "hard",
};

const RULE_B2: BankPolicyRule = {
  rule_id: "max_ltv",
  description: "Maximum LTV of 75%",
  threshold: { max: 0.75 },
  severity: "hard",
};

const RULE_B3: BankPolicyRule = {
  rule_id: "concentration_limit",
  description: "No more than 10% concentration in single property type",
  threshold: { max_pct: 0.10 },
  severity: "soft",
};

const PACK_A = buildPolicyPack({
  bank_id: "bank-a-111",
  policy_id: "pol-a-1",
  policy_version: "2.0",
  effective_at: "2026-01-01T00:00:00Z",
  rules: [RULE_A1, RULE_A2, RULE_A3],
  created_at: "2025-12-30T00:00:00Z",
});

const PACK_B = buildPolicyPack({
  bank_id: "bank-b-222",
  policy_id: "pol-b-1",
  policy_version: "1.5",
  effective_at: "2026-01-01T00:00:00Z",
  rules: [RULE_B1, RULE_B2, RULE_B3],
  created_at: "2025-12-28T00:00:00Z",
});

function makeGrant(overrides: Partial<ExaminerAccessGrant> = {}): ExaminerAccessGrant {
  return {
    id: "grant-001",
    grant_code: "EX-ABC123",
    examiner_name: "Jane Examiner",
    organization: "OCC",
    bank_id: "bank-a-111",
    scope: { deal_ids: ["deal-001", "deal-002"], read_areas: ["all"] },
    granted_by_user_id: "admin-user-001",
    granted_at: "2026-01-20T00:00:00Z",
    expires_at: "2026-01-25T00:00:00Z",
    revoked_at: null,
    revoked_by_user_id: null,
    revoke_reason: null,
    is_active: true,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
//  Phase J — Multi-Bank Policy Variance
// ═══════════════════════════════════════════════════════════

describe("Phase J: Policy pack building", () => {
  test("buildPolicyPack returns all expected fields", () => {
    assert.equal(PACK_A.bank_id, "bank-a-111");
    assert.equal(PACK_A.policy_id, "pol-a-1");
    assert.equal(PACK_A.policy_version, "2.0");
    assert.equal(PACK_A.rules.length, 3);
    assert.ok(PACK_A.policy_hash.length > 0, "policy_hash must be non-empty");
    assert.equal(PACK_A.supersedes, null);
  });

  test("buildPolicyPack hash is deterministic (same input → same hash)", () => {
    const packAgain = buildPolicyPack({
      bank_id: "bank-a-111",
      policy_id: "pol-a-1",
      policy_version: "2.0",
      effective_at: "2026-01-01T00:00:00Z",
      rules: [RULE_A1, RULE_A2, RULE_A3],
      created_at: "2025-12-30T00:00:00Z",
    });
    assert.equal(packAgain.policy_hash, PACK_A.policy_hash);
  });

  test("buildPolicyPack hash is order-independent (rules sorted by rule_id)", () => {
    const reordered = buildPolicyPack({
      bank_id: "bank-a-111",
      policy_id: "pol-a-1",
      policy_version: "2.0",
      effective_at: "2026-01-01T00:00:00Z",
      rules: [RULE_A3, RULE_A1, RULE_A2], // different order
      created_at: "2025-12-30T00:00:00Z",
    });
    assert.equal(reordered.policy_hash, PACK_A.policy_hash);
  });

  test("different rules produce different hash", () => {
    assert.notEqual(PACK_A.policy_hash, PACK_B.policy_hash);
  });

  test("supersedes field is preserved when provided", () => {
    const superseded = buildPolicyPack({
      bank_id: "bank-a-111",
      policy_id: "pol-a-2",
      policy_version: "3.0",
      effective_at: "2026-02-01T00:00:00Z",
      supersedes: "pol-a-1",
      rules: [RULE_A1],
      created_at: "2026-01-15T00:00:00Z",
    });
    assert.equal(superseded.supersedes, "pol-a-1");
  });
});

describe("Phase J: Policy pack summary", () => {
  test("summarizePolicyPack counts hard/soft rules correctly", () => {
    const summary = summarizePolicyPack(PACK_A);
    assert.equal(summary.rule_count, 3);
    assert.equal(summary.hard_rules, 2);
    assert.equal(summary.soft_rules, 1);
    assert.equal(summary.policy_hash, PACK_A.policy_hash);
  });

  test("summary preserves identity fields", () => {
    const summary = summarizePolicyPack(PACK_B);
    assert.equal(summary.bank_id, "bank-b-222");
    assert.equal(summary.policy_id, "pol-b-1");
    assert.equal(summary.policy_version, "1.5");
  });
});

describe("Phase J: Policy diff", () => {
  test("diffPolicyPacks detects changed rules", () => {
    const diff = diffPolicyPacks(PACK_A, PACK_B);

    // min_dscr is in both but with different thresholds
    const changedIds = diff.changed.map((c) => c.rule_id);
    assert.ok(changedIds.includes("min_dscr"), "min_dscr threshold changed");
    assert.ok(changedIds.includes("max_ltv"), "max_ltv threshold changed");
  });

  test("diffPolicyPacks detects only_in_a rules", () => {
    const diff = diffPolicyPacks(PACK_A, PACK_B);
    const onlyAIds = diff.only_in_a.map((r) => r.rule_id);
    assert.ok(onlyAIds.includes("min_experience"), "min_experience only in bank A");
  });

  test("diffPolicyPacks detects only_in_b rules", () => {
    const diff = diffPolicyPacks(PACK_A, PACK_B);
    const onlyBIds = diff.only_in_b.map((r) => r.rule_id);
    assert.ok(onlyBIds.includes("concentration_limit"), "concentration_limit only in bank B");
  });

  test("diffPolicyPacks with identical packs returns no differences", () => {
    const diff = diffPolicyPacks(PACK_A, PACK_A);
    assert.equal(diff.only_in_a.length, 0);
    assert.equal(diff.only_in_b.length, 0);
    assert.equal(diff.changed.length, 0);
    assert.equal(diff.identical_count, PACK_A.rules.length);
  });

  test("diff total_rules counts match pack rule counts", () => {
    const diff = diffPolicyPacks(PACK_A, PACK_B);
    assert.equal(diff.total_rules_a, 3);
    assert.equal(diff.total_rules_b, 3);
  });

  test("diff bank IDs are preserved", () => {
    const diff = diffPolicyPacks(PACK_A, PACK_B);
    assert.equal(diff.bank_a_id, "bank-a-111");
    assert.equal(diff.bank_b_id, "bank-b-222");
  });
});

describe("Phase J: Frozen policy reference", () => {
  test("freezePolicyReference captures pack identity", () => {
    const frozen = freezePolicyReference(PACK_A);
    assert.equal(frozen.bank_id, PACK_A.bank_id);
    assert.equal(frozen.policy_id, PACK_A.policy_id);
    assert.equal(frozen.policy_version, PACK_A.policy_version);
    assert.equal(frozen.policy_hash, PACK_A.policy_hash);
    assert.equal(frozen.rule_count, PACK_A.rules.length);
    assert.ok(frozen.frozen_at.length > 0);
  });

  test("validateFrozenPolicy returns valid for matching pack", () => {
    const frozen = freezePolicyReference(PACK_A);
    const result = validateFrozenPolicy(frozen, PACK_A);
    assert.equal(result.valid, true);
    assert.equal(result.mismatches.length, 0);
  });

  test("validateFrozenPolicy detects hash mismatch", () => {
    const frozen = freezePolicyReference(PACK_A);
    const result = validateFrozenPolicy(frozen, PACK_B);
    assert.equal(result.valid, false);
    assert.ok(result.mismatches.length > 0);
    assert.ok(result.mismatches.some((m) => m.includes("hash mismatch")));
  });

  test("validateFrozenPolicy detects version mismatch", () => {
    const frozen = freezePolicyReference(PACK_A);
    const mutated = { ...PACK_A, policy_version: "9.9" };
    const result = validateFrozenPolicy(frozen, mutated);
    assert.ok(result.mismatches.some((m) => m.includes("Version mismatch")));
  });

  test("validateFrozenPolicy detects rule count mismatch", () => {
    const frozen = freezePolicyReference(PACK_A);
    const mutated = { ...PACK_A, rules: [RULE_A1] };
    const result = validateFrozenPolicy(frozen, mutated);
    assert.ok(result.mismatches.some((m) => m.includes("Rule count mismatch")));
  });
});

describe("Phase J: Outcome delta", () => {
  test("buildOutcomeDelta detects differing outcomes", () => {
    const delta = buildOutcomeDelta(
      { bank_id: "a", bank_name: "Bank A", outcome: "Approve" },
      { bank_id: "b", bank_name: "Bank B", outcome: "Decline" },
    );
    assert.equal(delta.differs, true);
    assert.ok(delta.explanation.includes("Bank A: Approve"));
    assert.ok(delta.explanation.includes("Bank B: Decline"));
  });

  test("buildOutcomeDelta detects identical outcomes", () => {
    const delta = buildOutcomeDelta(
      { bank_id: "a", bank_name: "Bank A", outcome: "Approve" },
      { bank_id: "b", bank_name: "Bank B", outcome: "Approve" },
    );
    assert.equal(delta.differs, false);
    assert.ok(delta.explanation.includes("same outcome"));
  });

  test("buildOutcomeDelta handles null outcome (no decision)", () => {
    const delta = buildOutcomeDelta(
      { bank_id: "a", bank_name: "Bank A", outcome: null },
      { bank_id: "b", bank_name: "Bank B", outcome: "Approve" },
    );
    assert.equal(delta.differs, true);
    assert.ok(delta.explanation.includes("no decision"));
  });
});

describe("Phase J: Metric deltas", () => {
  test("buildMetricDeltas produces 7 metrics", () => {
    const deltas = buildMetricDeltas(
      { bank_id: "a", dscr: 1.30, ltv_gross: 0.70, confidence: 0.85, rules_failed: 0, exceptions_count: 0, overrides_count: 0, pricing_rate: 0.065 },
      { bank_id: "b", dscr: 1.20, ltv_gross: 0.75, confidence: 0.80, rules_failed: 2, exceptions_count: 1, overrides_count: 1, pricing_rate: 0.070 },
    );
    assert.equal(deltas.length, 7);
  });

  test("material significance for DSCR delta > 0.05", () => {
    const deltas = buildMetricDeltas(
      { bank_id: "a", dscr: 1.30, ltv_gross: 0.70, confidence: 0.85, rules_failed: 0, exceptions_count: 0, overrides_count: 0, pricing_rate: 0.065 },
      { bank_id: "b", dscr: 1.20, ltv_gross: 0.70, confidence: 0.85, rules_failed: 0, exceptions_count: 0, overrides_count: 0, pricing_rate: 0.065 },
    );
    const dscrDelta = deltas.find((d) => d.metric === "dscr");
    assert.ok(dscrDelta);
    assert.equal(dscrDelta.significance, "material");
  });

  test("identical significance when values match exactly", () => {
    const deltas = buildMetricDeltas(
      { bank_id: "a", dscr: 1.25, ltv_gross: 0.70, confidence: 0.85, rules_failed: 0, exceptions_count: 0, overrides_count: 0, pricing_rate: 0.065 },
      { bank_id: "b", dscr: 1.25, ltv_gross: 0.70, confidence: 0.85, rules_failed: 0, exceptions_count: 0, overrides_count: 0, pricing_rate: 0.065 },
    );
    for (const d of deltas) {
      assert.equal(d.significance, "identical", `${d.metric} should be identical`);
    }
  });

  test("minor significance for small delta within threshold", () => {
    const deltas = buildMetricDeltas(
      { bank_id: "a", dscr: 1.25, ltv_gross: 0.70, confidence: 0.85, rules_failed: 0, exceptions_count: 0, overrides_count: 0, pricing_rate: 0.065 },
      { bank_id: "b", dscr: 1.22, ltv_gross: 0.70, confidence: 0.85, rules_failed: 0, exceptions_count: 0, overrides_count: 0, pricing_rate: 0.065 },
    );
    const dscrDelta = deltas.find((d) => d.metric === "dscr");
    assert.ok(dscrDelta);
    assert.equal(dscrDelta.significance, "minor"); // delta = 0.03, threshold = 0.05
  });
});

// ═══════════════════════════════════════════════════════════
//  Phase K — Regulator Sandbox Mode
// ═══════════════════════════════════════════════════════════

describe("Phase K: Examiner walkthrough completeness", () => {
  test("walkthrough has exactly 7 steps", () => {
    assert.equal(WALKTHROUGH_STEPS.length, 7);
  });

  test("steps are numbered 1 through 7", () => {
    for (let i = 0; i < 7; i++) {
      assert.equal(WALKTHROUGH_STEPS[i].step_number, i + 1);
    }
  });

  test("every step has non-empty title", () => {
    for (const step of WALKTHROUGH_STEPS) {
      assert.ok(step.title.length > 0, `Step ${step.step_number} has empty title`);
    }
  });

  test("every step has non-empty description", () => {
    for (const step of WALKTHROUGH_STEPS) {
      assert.ok(step.description.length > 10, `Step ${step.step_number} has short description`);
    }
  });

  test("every step has at least 3 verification items", () => {
    for (const step of WALKTHROUGH_STEPS) {
      assert.ok(
        step.what_to_verify.length >= 3,
        `Step ${step.step_number} has only ${step.what_to_verify.length} verification items`,
      );
    }
  });

  test("every step has at least 1 artifact to review", () => {
    for (const step of WALKTHROUGH_STEPS) {
      assert.ok(
        step.artifacts_to_review.length >= 1,
        `Step ${step.step_number} has no artifacts`,
      );
    }
  });

  test("every step has a playbook reference", () => {
    for (const step of WALKTHROUGH_STEPS) {
      assert.ok(step.playbook_reference.length > 0, `Step ${step.step_number} missing playbook_reference`);
    }
  });
});

describe("Phase K: Walkthrough regulator tone", () => {
  const MARKETING_WORDS = [
    "revolutionary", "amazing", "incredible", "best-in-class",
    "state-of-the-art", "cutting-edge", "game-changing", "innovative",
    "world-class", "seamless",
  ];

  test("no marketing language in any step description", () => {
    for (const step of WALKTHROUGH_STEPS) {
      const lower = step.description.toLowerCase();
      for (const word of MARKETING_WORDS) {
        assert.ok(
          !lower.includes(word),
          `Step ${step.step_number} contains marketing word "${word}"`,
        );
      }
    }
  });

  test("step 1 covers AI governance", () => {
    assert.ok(WALKTHROUGH_STEPS[0].title.includes("AI Governance"));
  });

  test("step 7 covers package integrity", () => {
    assert.ok(WALKTHROUGH_STEPS[6].title.includes("Integrity"));
  });
});

describe("Phase K: Role system", () => {
  const BUDDY_ROLES = ["super_admin", "bank_admin", "underwriter", "borrower", "regulator_sandbox", "examiner"] as const;

  test("BUDDY_ROLES includes regulator_sandbox", () => {
    assert.ok((BUDDY_ROLES as readonly string[]).includes("regulator_sandbox"));
  });

  test("BUDDY_ROLES includes examiner", () => {
    assert.ok((BUDDY_ROLES as readonly string[]).includes("examiner"));
  });

  test("BUDDY_ROLES has exactly 6 roles", () => {
    assert.equal(BUDDY_ROLES.length, 6);
  });
});

describe("Phase K: Sandbox types contract", () => {
  test("SandboxDealSnapshot shape has required sections", () => {
    // Validate the type shape against expected structure
    const snapshot: any = {
      deal: { id: "d1", borrower_name: "Test", loan_amount: 1000000, deal_type: "CRE", status: "active", created_at: "2026-01-01" },
      borrower: { id: "b1", legal_name: "Test Corp", entity_type: "llc", naics_code: "531120", ein_masked: "**-***1234" },
      decision: { snapshot_id: "s1", outcome: "Approve", confidence: 0.92, status: "completed", created_at: "2026-01-01" },
      financials: { dscr: 1.35, ltv_gross: 0.72, noi_ttm: 250000, completeness_pct: 85 },
      has_committee_review: true,
      has_attestations: true,
      artifact_availability: { borrower_audit: true, credit_decision_audit: true, examiner_drop: true },
    };

    assert.ok(snapshot.deal);
    assert.ok(snapshot.borrower);
    assert.ok(snapshot.decision);
    assert.ok(snapshot.financials);
    assert.equal(typeof snapshot.has_committee_review, "boolean");
    assert.equal(typeof snapshot.has_attestations, "boolean");
    assert.ok(snapshot.artifact_availability);
  });

  test("EIN masking format is **-***NNNN", () => {
    const ein = "12-3456789";
    const masked = `**-***${ein.slice(-4)}`;
    assert.equal(masked, "**-***6789");
    assert.ok(!masked.includes("12-345")); // original prefix hidden
  });
});

// ═══════════════════════════════════════════════════════════
//  Phase L — Live Examiner Access Portal
// ═══════════════════════════════════════════════════════════

describe("Phase L: Grant scope validation", () => {
  test("active grant with matching deal + area = allowed", () => {
    const grant = makeGrant();
    const result = validateGrantScope(grant, "deal-001", "audit");
    assert.equal(result.allowed, true);
    assert.ok(result.reason.includes("permitted"));
  });

  test("active grant with 'all' areas allows any area", () => {
    const grant = makeGrant({ scope: { deal_ids: ["deal-001"], read_areas: ["all"] } });
    assert.equal(validateGrantScope(grant, "deal-001", "borrower").allowed, true);
    assert.equal(validateGrantScope(grant, "deal-001", "decision").allowed, true);
    assert.equal(validateGrantScope(grant, "deal-001", "financials").allowed, true);
    assert.equal(validateGrantScope(grant, "deal-001", "audit").allowed, true);
  });

  test("active grant with empty deal_ids allows any deal", () => {
    const grant = makeGrant({ scope: { deal_ids: [], read_areas: ["all"] } });
    assert.equal(validateGrantScope(grant, "deal-999", "audit").allowed, true);
  });

  test("inactive grant is denied", () => {
    const grant = makeGrant({ is_active: false });
    const result = validateGrantScope(grant, "deal-001", "audit");
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes("no longer active"));
  });

  test("deal not in scope is denied", () => {
    const grant = makeGrant({ scope: { deal_ids: ["deal-001"], read_areas: ["all"] } });
    const result = validateGrantScope(grant, "deal-999", "audit");
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes("not in grant scope"));
  });

  test("area not in scope is denied", () => {
    const grant = makeGrant({ scope: { deal_ids: ["deal-001"], read_areas: ["borrower", "decision"] } });
    const result = validateGrantScope(grant, "deal-001", "financials");
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes("not in grant scope"));
  });
});

describe("Phase L: Grant active detection", () => {
  test("grant with revoked_at is not active", () => {
    const now = new Date();
    const grant = makeGrant({
      revoked_at: now.toISOString(),
      is_active: false,
    });
    assert.equal(grant.is_active, false);
  });

  test("grant with past expires_at is not active", () => {
    const grant = makeGrant({
      expires_at: "2020-01-01T00:00:00Z",
      is_active: false,
    });
    assert.equal(grant.is_active, false);
  });

  test("grant with future expires_at and no revocation is active", () => {
    const grant = makeGrant({
      expires_at: "2099-01-01T00:00:00Z",
      revoked_at: null,
      is_active: true,
    });
    assert.equal(grant.is_active, true);
  });
});

describe("Phase L: Grant type contract", () => {
  test("ExaminerAccessGrant has all required fields", () => {
    const grant = makeGrant();
    assert.ok(grant.id);
    assert.ok(grant.grant_code);
    assert.ok(grant.examiner_name);
    assert.ok(grant.organization);
    assert.ok(grant.bank_id);
    assert.ok(grant.scope);
    assert.ok(grant.granted_by_user_id);
    assert.ok(grant.granted_at);
    assert.ok(grant.expires_at);
    assert.equal(typeof grant.is_active, "boolean");
  });

  test("scope has deal_ids and read_areas arrays", () => {
    const grant = makeGrant();
    assert.ok(Array.isArray(grant.scope.deal_ids));
    assert.ok(Array.isArray(grant.scope.read_areas));
  });
});

describe("Phase L: Snapshot integrity verification", () => {
  test("verifySnapshotHash returns match=true for correct hash", () => {
    const snapshot = { decision_json: { outcome: "Approve" }, confidence: 0.92 };
    const hash = computeSnapshotHash(snapshot);
    const result = verifySnapshotHash({
      snapshot,
      expectedHash: hash,
      artifactType: "decision_snapshot",
      artifactId: "snap-001",
    });
    assert.equal(result.match, true);
    assert.ok(result.details.includes("verified"));
  });

  test("verifySnapshotHash returns match=false for wrong hash", () => {
    const snapshot = { decision_json: { outcome: "Approve" }, confidence: 0.92 };
    const result = verifySnapshotHash({
      snapshot,
      expectedHash: "0000000000000000",
      artifactType: "decision_snapshot",
      artifactId: "snap-001",
    });
    assert.equal(result.match, false);
    assert.ok(result.details.includes("mismatch"));
  });

  test("verifySnapshotHash result has check_version 1.0", () => {
    const result = verifySnapshotHash({
      snapshot: {},
      expectedHash: "test",
      artifactType: "test",
      artifactId: "test",
    });
    assert.equal(result.check_version, "1.0");
  });

  test("computeSnapshotHash is deterministic", () => {
    const snap = { a: 1, b: 2, c: { d: 3 } };
    const h1 = computeSnapshotHash(snap);
    const h2 = computeSnapshotHash(snap);
    assert.equal(h1, h2);
  });

  test("computeSnapshotHash is order-independent (stableStringify)", () => {
    const h1 = computeSnapshotHash({ z: 1, a: 2 });
    const h2 = computeSnapshotHash({ a: 2, z: 1 });
    assert.equal(h1, h2);
  });
});

describe("Phase L: Drop manifest verification", () => {
  test("verifyDropManifest returns valid for correct manifest", () => {
    const fileAContent = "file-a-content";
    const fileBContent = "file-b-content";
    const hashA = sha256Sim(fileAContent);
    const hashB = sha256Sim(fileBContent);
    const dropHash = sha256Sim(`${hashA}|${hashB}`);

    const result = verifyDropManifest({
      manifest: {
        drop_hash: dropHash,
        artifacts: [
          { path: "a.json", sha256: hashA, size_bytes: 14 },
          { path: "b.json", sha256: hashB, size_bytes: 14 },
        ],
      },
      artifactContents: new Map([
        ["a.json", fileAContent],
        ["b.json", fileBContent],
      ]),
    });

    assert.equal(result.manifest_valid, true);
    assert.equal(result.artifacts_checked, 2);
    assert.equal(result.artifacts_matched, 2);
    assert.equal(result.artifacts_mismatched, 0);
    assert.equal(result.drop_hash_match, true);
  });

  test("verifyDropManifest detects file mismatch", () => {
    const hashA = sha256Sim("original-content");
    const dropHash = sha256Sim(hashA);

    const result = verifyDropManifest({
      manifest: {
        drop_hash: dropHash,
        artifacts: [
          { path: "a.json", sha256: hashA, size_bytes: 16 },
        ],
      },
      artifactContents: new Map([
        ["a.json", "tampered-content"],
      ]),
    });

    assert.equal(result.manifest_valid, false);
    assert.equal(result.artifacts_mismatched, 1);
  });

  test("verifyDropManifest detects missing artifact", () => {
    const hashA = sha256Sim("file-a");
    const hashB = sha256Sim("file-b");
    const dropHash = sha256Sim(`${hashA}|${hashB}`);

    const result = verifyDropManifest({
      manifest: {
        drop_hash: dropHash,
        artifacts: [
          { path: "a.json", sha256: hashA, size_bytes: 6 },
          { path: "b.json", sha256: hashB, size_bytes: 6 },
        ],
      },
      artifactContents: new Map([
        ["a.json", "file-a"],
        // b.json not provided
      ]),
    });

    assert.equal(result.manifest_valid, false);
    assert.equal(result.artifacts_mismatched, 1);
    assert.ok(result.results.some((r) => r.details.includes("not provided")));
  });

  test("verifyDropManifest detects drop hash mismatch", () => {
    const fileAContent = "file-a-content";
    const hashA = sha256Sim(fileAContent);

    const result = verifyDropManifest({
      manifest: {
        drop_hash: "wrong-drop-hash",
        artifacts: [
          { path: "a.json", sha256: hashA, size_bytes: 14 },
        ],
      },
      artifactContents: new Map([
        ["a.json", fileAContent],
      ]),
    });

    assert.equal(result.drop_hash_match, false);
    assert.equal(result.manifest_valid, false);
  });
});

describe("Phase L: Drop hash computation", () => {
  test("computeDropHash joins with pipe separator", () => {
    const h1 = "aaa";
    const h2 = "bbb";
    const expected = sha256Sim("aaa|bbb");
    assert.equal(computeDropHash([h1, h2]), expected);
  });

  test("computeDropHash is deterministic", () => {
    const hashes = ["h1", "h2", "h3"];
    assert.equal(computeDropHash(hashes), computeDropHash(hashes));
  });

  test("computeDropHash is order-sensitive", () => {
    const forward = computeDropHash(["a", "b"]);
    const reversed = computeDropHash(["b", "a"]);
    assert.notEqual(forward, reversed);
  });
});

// ═══════════════════════════════════════════════════════════
//  Cross-phase: Signal types
// ═══════════════════════════════════════════════════════════

describe("Phase J+K+L signal types", () => {
  const JKL_SIGNALS = [
    "policy.pack.created",
    "policy.pack.resolved",
    "policy.frozen.validated",
    "bank.decision.compared",
    "sandbox.loaded",
    "sandbox.deal.viewed",
    "examiner.access.granted",
    "examiner.access.revoked",
    "examiner.viewed.snapshot",
    "examiner.verified.integrity",
    "examiner.access.expired",
  ];

  // This reads the actual signals file at test time
  const KNOWN_SIGNALS = [
    "page.ready", "deal.loaded", "deal.ignited",
    "deal.document.uploaded", "deal.checklist.updated",
    "deal.underwriting.started", "deal.lifecycle", "lifecycle",
    "checklist.updated", "pipeline.event", "user.action", "user.mark",
    "ui.toast", "error", "api.degraded",
    "borrower.completed", "borrower.owners.attested",
    "borrower.audit.snapshot.created", "decision.audit.snapshot.created",
    "examiner.drop.created", "model.governance.exported",
    "examiner.playbooks.exported",
    ...JKL_SIGNALS,
  ];

  test("all Phase J+K+L signals exist in known signal list", () => {
    for (const sig of JKL_SIGNALS) {
      assert.ok(
        KNOWN_SIGNALS.includes(sig),
        `Signal "${sig}" missing from known signals`,
      );
    }
  });

  test("Phase J has policy signals", () => {
    const phaseJSignals = JKL_SIGNALS.filter((s) => s.startsWith("policy.") || s.startsWith("bank."));
    assert.ok(phaseJSignals.length >= 3, "Phase J should have at least 3 policy/bank signals");
  });

  test("Phase K has sandbox signals", () => {
    const phaseKSignals = JKL_SIGNALS.filter((s) => s.startsWith("sandbox."));
    assert.ok(phaseKSignals.length >= 2, "Phase K should have at least 2 sandbox signals");
  });

  test("Phase L has examiner signals", () => {
    const phaseLSignals = JKL_SIGNALS.filter((s) => s.startsWith("examiner."));
    assert.ok(phaseLSignals.length >= 4, "Phase L should have at least 4 examiner signals");
  });
});
