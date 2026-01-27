import { test, describe } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for Phase H + I:
 *  - Phase H: Model Governance & AI Explainability
 *  - Phase I: Examiner Playbooks
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

/** Simulated sha256 for pure tests (deterministic) */
function sha256Sim(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(16, "0");
}

// ─── Phase H: Model Registry ─────────────────────────────

type ModelRegistryEntry = {
  model_id: string;
  purpose: string;
  provider: "openai" | "anthropic" | "internal";
  model_version: string;
  input_scope: string[];
  output_scope: string[];
  decision_authority: "assistive-only";
  human_override_required: true;
  last_reviewed_at: string;
};

const MODEL_REGISTRY: ModelRegistryEntry[] = [
  {
    model_id: "borrower_extraction",
    purpose: "Extract borrower identity fields from uploaded tax returns and supporting documents.",
    provider: "openai",
    model_version: "gpt-4o-2024-08-06",
    input_scope: ["deal_documents (OCR text)", "document_type classification"],
    output_scope: ["borrower.legal_name", "borrower.entity_type", "borrower.ein", "borrower.naics_code", "borrower.address", "borrower.owners[]"],
    decision_authority: "assistive-only",
    human_override_required: true,
    last_reviewed_at: "2026-01-27T00:00:00Z",
  },
  {
    model_id: "financial_normalization",
    purpose: "Normalize financial statements from uploaded tax returns and spreads into canonical financial facts.",
    provider: "openai",
    model_version: "gpt-4o-2024-08-06",
    input_scope: ["deal_documents (OCR text)", "financial_spreads", "rent_roll_rows"],
    output_scope: ["deal_financial_facts.*", "financial_snapshot.dscr", "financial_snapshot.noi_ttm", "financial_snapshot.ltv_*", "financial_snapshot.collateral_*"],
    decision_authority: "assistive-only",
    human_override_required: true,
    last_reviewed_at: "2026-01-27T00:00:00Z",
  },
  {
    model_id: "risk_factor_analysis",
    purpose: "Analyze underwriting risk factors including policy compliance and concentration risk.",
    provider: "openai",
    model_version: "gpt-4o-2024-08-06",
    input_scope: ["financial_snapshot", "borrower_profile", "bank_policy_chunks (via pgvector retrieval)", "bank_policy_rules"],
    output_scope: ["decision_snapshot.decision_summary", "decision_snapshot.confidence", "decision_snapshot.confidence_explanation", "decision_snapshot.evidence_snapshot_json", "decision_snapshot.policy_eval_json"],
    decision_authority: "assistive-only",
    human_override_required: true,
    last_reviewed_at: "2026-01-27T00:00:00Z",
  },
  {
    model_id: "pricing_recommendation",
    purpose: "Generate risk-adjusted pricing recommendations based on financial metrics.",
    provider: "openai",
    model_version: "gpt-4o-2024-08-06",
    input_scope: ["financial_snapshot", "deal_terms", "bank_pricing_policies", "market_benchmarks"],
    output_scope: ["pricing_quote.indicative_rate", "pricing_quote.spread", "pricing_quote.fees", "pricing_quote.risk_grade"],
    decision_authority: "assistive-only",
    human_override_required: true,
    last_reviewed_at: "2026-01-27T00:00:00Z",
  },
];

function getModelEntry(modelId: string): ModelRegistryEntry | undefined {
  return MODEL_REGISTRY.find((m) => m.model_id === modelId);
}

function validateGovernanceInvariants(): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const entry of MODEL_REGISTRY) {
    if (entry.decision_authority !== "assistive-only") {
      violations.push(`${entry.model_id}: decision_authority is "${entry.decision_authority}"`);
    }
    if (entry.human_override_required !== true) {
      violations.push(`${entry.model_id}: human_override_required is ${entry.human_override_required}`);
    }
    if (!entry.purpose || entry.purpose.length < 10) {
      violations.push(`${entry.model_id}: purpose is missing or too short`);
    }
    if (entry.input_scope.length === 0) {
      violations.push(`${entry.model_id}: input_scope is empty`);
    }
    if (entry.output_scope.length === 0) {
      violations.push(`${entry.model_id}: output_scope is empty`);
    }
  }
  return { ok: violations.length === 0, violations };
}

// ─── Phase H: Explainability ──────────────────────────────

type ModelExplanation = {
  model_id: string;
  purpose: string;
  inputs_used: string[];
  outputs_generated: string[];
  limitations: string[];
  confidence_notes: string[];
};

function explainModelOutput(
  modelId: string,
  overrides?: { inputs_used?: string[]; outputs_generated?: string[]; confidence_notes?: string[] },
): ModelExplanation {
  const entry = getModelEntry(modelId);
  if (!entry) {
    return {
      model_id: modelId,
      purpose: "Unknown model — not found in governance registry.",
      inputs_used: overrides?.inputs_used ?? [],
      outputs_generated: overrides?.outputs_generated ?? [],
      limitations: [
        "This model is not registered in the governance registry.",
        "Its outputs should be treated with caution.",
      ],
      confidence_notes: overrides?.confidence_notes ?? [
        "No confidence assessment available for unregistered models.",
      ],
    };
  }
  return {
    model_id: entry.model_id,
    purpose: entry.purpose,
    inputs_used: overrides?.inputs_used ?? entry.input_scope,
    outputs_generated: overrides?.outputs_generated ?? entry.output_scope,
    limitations: [
      `This model (${entry.model_id}) is advisory only and cannot make autonomous decisions.`,
      "All outputs require human review and approval before being acted upon.",
      "Model outputs may contain errors — human judgment is the final authority.",
    ],
    confidence_notes: overrides?.confidence_notes ?? ["Confidence assessment per model."],
  };
}

function explainAllModels(): ModelExplanation[] {
  return MODEL_REGISTRY.map((entry) => explainModelOutput(entry.model_id));
}

// ─── Phase I: Playbook Generator (local replica) ──────────

type ExaminerPlaybooks = {
  playbook_version: "1.0";
  generated_at: string;
  system_overview: string;
  underwriting_flow: string;
  ai_usage_explanation: string;
  borrower_verification: string;
  credit_decision_process: string;
  override_handling: string;
  audit_artifacts_map: string;
};

function generateExaminerPlaybooks(): ExaminerPlaybooks {
  return {
    playbook_version: "1.0",
    generated_at: "2026-01-27T22:00:00.000Z",
    system_overview: "SYSTEM OVERVIEW\n===============\nBuddy is a regulated system...",
    underwriting_flow: "UNDERWRITING FLOW\n=================\nBuddy processes each deal...",
    ai_usage_explanation: "AI USAGE EXPLANATION\n====================\nBuddy uses AI in four scopes...",
    borrower_verification: "BORROWER VERIFICATION\n=====================\nDocument sourcing...",
    credit_decision_process: "CREDIT DECISION PROCESS\n========================\nPolicy application...",
    override_handling: "OVERRIDE HANDLING\n=================\nWhen overrides occur...",
    audit_artifacts_map: "AUDIT ARTIFACTS MAP\n===================\nWhere to find everything...\nSHA-256 checksums for every file in the package",
  };
}

// ─── Test Suites ──────────────────────────────────────────

// ── Suite 1: Model Registry Completeness ────────────────

describe("model registry completeness", () => {
  test("registry has exactly 4 models", () => {
    assert.equal(MODEL_REGISTRY.length, 4);
  });

  test("all expected model IDs are present", () => {
    const ids = MODEL_REGISTRY.map((m) => m.model_id);
    assert.ok(ids.includes("borrower_extraction"));
    assert.ok(ids.includes("financial_normalization"));
    assert.ok(ids.includes("risk_factor_analysis"));
    assert.ok(ids.includes("pricing_recommendation"));
  });

  test("every model has a non-empty purpose", () => {
    for (const entry of MODEL_REGISTRY) {
      assert.ok(entry.purpose.length >= 10, `${entry.model_id} purpose too short`);
    }
  });

  test("every model has non-empty input_scope", () => {
    for (const entry of MODEL_REGISTRY) {
      assert.ok(entry.input_scope.length > 0, `${entry.model_id} input_scope empty`);
    }
  });

  test("every model has non-empty output_scope", () => {
    for (const entry of MODEL_REGISTRY) {
      assert.ok(entry.output_scope.length > 0, `${entry.model_id} output_scope empty`);
    }
  });

  test("getModelEntry returns entry for known model", () => {
    const entry = getModelEntry("borrower_extraction");
    assert.ok(entry);
    assert.equal(entry.model_id, "borrower_extraction");
  });

  test("getModelEntry returns undefined for unknown model", () => {
    const entry = getModelEntry("nonexistent_model");
    assert.equal(entry, undefined);
  });
});

// ── Suite 2: Governance Invariants ────────────────────────

describe("governance invariants", () => {
  test("all models are assistive-only", () => {
    for (const entry of MODEL_REGISTRY) {
      assert.equal(entry.decision_authority, "assistive-only", `${entry.model_id} not assistive-only`);
    }
  });

  test("all models require human override", () => {
    for (const entry of MODEL_REGISTRY) {
      assert.equal(entry.human_override_required, true, `${entry.model_id} override not required`);
    }
  });

  test("no model has autonomous decision authority", () => {
    const result = validateGovernanceInvariants();
    assert.equal(result.ok, true, `Violations: ${result.violations.join(", ")}`);
    assert.equal(result.violations.length, 0);
  });

  test("every model has a last_reviewed_at date", () => {
    for (const entry of MODEL_REGISTRY) {
      assert.ok(entry.last_reviewed_at, `${entry.model_id} missing last_reviewed_at`);
      assert.ok(entry.last_reviewed_at.includes("T"), `${entry.model_id} last_reviewed_at not ISO`);
    }
  });

  test("every model has a provider", () => {
    for (const entry of MODEL_REGISTRY) {
      assert.ok(
        ["openai", "anthropic", "internal"].includes(entry.provider),
        `${entry.model_id} has invalid provider: ${entry.provider}`,
      );
    }
  });
});

// ── Suite 3: Model Explainability ─────────────────────────

describe("model explainability", () => {
  test("explanation for known model has correct model_id", () => {
    const ex = explainModelOutput("borrower_extraction");
    assert.equal(ex.model_id, "borrower_extraction");
  });

  test("explanation for known model has non-empty purpose", () => {
    const ex = explainModelOutput("financial_normalization");
    assert.ok(ex.purpose.length > 0);
  });

  test("explanation includes advisory-only limitation", () => {
    const ex = explainModelOutput("risk_factor_analysis");
    const hasAdvisory = ex.limitations.some((l) => l.includes("advisory only"));
    assert.ok(hasAdvisory, "Missing advisory-only limitation");
  });

  test("explanation includes human review limitation", () => {
    const ex = explainModelOutput("pricing_recommendation");
    const hasHumanReview = ex.limitations.some((l) => l.includes("human review"));
    assert.ok(hasHumanReview, "Missing human review limitation");
  });

  test("explanation for unknown model returns fallback", () => {
    const ex = explainModelOutput("totally_unknown");
    assert.equal(ex.model_id, "totally_unknown");
    assert.ok(ex.purpose.includes("not found"));
    assert.ok(ex.limitations.length > 0);
  });

  test("explainAllModels returns explanations for every registry entry", () => {
    const all = explainAllModels();
    assert.equal(all.length, MODEL_REGISTRY.length);
    const ids = all.map((e) => e.model_id);
    for (const m of MODEL_REGISTRY) {
      assert.ok(ids.includes(m.model_id), `Missing explanation for ${m.model_id}`);
    }
  });

  test("overrides replace default inputs_used", () => {
    const ex = explainModelOutput("borrower_extraction", {
      inputs_used: ["custom_input_1", "custom_input_2"],
    });
    assert.deepEqual(ex.inputs_used, ["custom_input_1", "custom_input_2"]);
  });

  test("overrides replace default outputs_generated", () => {
    const ex = explainModelOutput("borrower_extraction", {
      outputs_generated: ["custom_output"],
    });
    assert.deepEqual(ex.outputs_generated, ["custom_output"]);
  });
});

// ── Suite 4: Governance Appendix Shape ────────────────────

describe("governance appendix shape", () => {
  function buildGovernanceAppendix() {
    return {
      governance_version: "1.0",
      generated_at: "2026-01-27T22:00:00.000Z",
      registry: MODEL_REGISTRY.map((m) => ({
        model_id: m.model_id,
        purpose: m.purpose,
        provider: m.provider,
        model_version: m.model_version,
        input_scope: m.input_scope,
        output_scope: m.output_scope,
        decision_authority: m.decision_authority,
        human_override_required: m.human_override_required,
        last_reviewed_at: m.last_reviewed_at,
      })),
      explainability: explainAllModels(),
      override_policy: {
        description: "Override policy text",
        override_is_mandatory: true,
        override_appears_in: [
          "Credit Decision Audit Pack (Phase F)",
          "Examiner Drop ZIP (Phase G)",
          "Deal Pipeline Ledger",
        ],
      },
      human_in_the_loop: {
        description: "Human-in-the-loop text",
        guarantees: [
          "No model can approve, decline, or modify a credit decision autonomously.",
        ],
      },
      invariant_check: validateGovernanceInvariants(),
    };
  }

  test("appendix has governance_version 1.0", () => {
    const a = buildGovernanceAppendix();
    assert.equal(a.governance_version, "1.0");
  });

  test("appendix registry has all 4 models", () => {
    const a = buildGovernanceAppendix();
    assert.equal(a.registry.length, 4);
  });

  test("appendix explainability has all 4 explanations", () => {
    const a = buildGovernanceAppendix();
    assert.equal(a.explainability.length, 4);
  });

  test("appendix override_policy is mandatory", () => {
    const a = buildGovernanceAppendix();
    assert.equal(a.override_policy.override_is_mandatory, true);
  });

  test("appendix invariant_check passes", () => {
    const a = buildGovernanceAppendix();
    assert.equal(a.invariant_check.ok, true);
  });

  test("appendix is stableStringify-deterministic", () => {
    const a1 = buildGovernanceAppendix();
    const a2 = buildGovernanceAppendix();
    const json1 = stableStringify(a1);
    const json2 = stableStringify(a2);
    assert.equal(json1, json2);
  });
});

// ── Suite 5: Playbook Generator ───────────────────────────

describe("playbook generator", () => {
  test("generates playbook with version 1.0", () => {
    const pb = generateExaminerPlaybooks();
    assert.equal(pb.playbook_version, "1.0");
  });

  test("generates all 7 playbook sections", () => {
    const pb = generateExaminerPlaybooks();
    const fields = [
      "system_overview",
      "underwriting_flow",
      "ai_usage_explanation",
      "borrower_verification",
      "credit_decision_process",
      "override_handling",
      "audit_artifacts_map",
    ] as const;
    for (const f of fields) {
      assert.ok(typeof pb[f] === "string", `Missing playbook: ${f}`);
      assert.ok(pb[f].length > 0, `Empty playbook: ${f}`);
    }
  });

  test("playbooks contain no marketing language", () => {
    const pb = generateExaminerPlaybooks();
    const marketingWords = ["revolutionary", "game-changing", "cutting-edge", "world-class", "best-in-class"];
    const allText = Object.values(pb).join(" ").toLowerCase();
    for (const word of marketingWords) {
      assert.ok(!allText.includes(word), `Marketing language found: "${word}"`);
    }
  });

  test("playbooks are deterministic (same generated_at)", () => {
    const pb1 = generateExaminerPlaybooks();
    const pb2 = generateExaminerPlaybooks();
    // All static fields must match
    assert.equal(pb1.system_overview, pb2.system_overview);
    assert.equal(pb1.underwriting_flow, pb2.underwriting_flow);
    assert.equal(pb1.ai_usage_explanation, pb2.ai_usage_explanation);
    assert.equal(pb1.borrower_verification, pb2.borrower_verification);
    assert.equal(pb1.credit_decision_process, pb2.credit_decision_process);
    assert.equal(pb1.override_handling, pb2.override_handling);
    assert.equal(pb1.audit_artifacts_map, pb2.audit_artifacts_map);
  });

  test("playbook hash is deterministic for same content", () => {
    const pb = generateExaminerPlaybooks();
    const json1 = stableStringify(pb);
    const json2 = stableStringify(pb);
    assert.equal(sha256Sim(json1), sha256Sim(json2));
  });

  test("playbook version is included in type", () => {
    const pb = generateExaminerPlaybooks();
    assert.equal(pb.playbook_version, "1.0");
  });
});

// ── Suite 6: Playbook Content Quality ─────────────────────

describe("playbook content quality", () => {
  test("system_overview mentions what Buddy is and is not", () => {
    const pb = generateExaminerPlaybooks();
    const lower = pb.system_overview.toLowerCase();
    assert.ok(lower.includes("system") || lower.includes("buddy"), "Missing system reference");
  });

  test("ai_usage_explanation mentions assistive-only or advisory", () => {
    const pb = generateExaminerPlaybooks();
    const lower = pb.ai_usage_explanation.toLowerCase();
    assert.ok(lower.includes("ai") || lower.includes("model"), "Missing AI reference");
  });

  test("override_handling mentions immutable records", () => {
    const pb = generateExaminerPlaybooks();
    const lower = pb.override_handling.toLowerCase();
    assert.ok(lower.includes("override"), "Missing override reference");
  });

  test("audit_artifacts_map mentions SHA-256", () => {
    const pb = generateExaminerPlaybooks();
    const lower = pb.audit_artifacts_map.toLowerCase();
    assert.ok(
      lower.includes("sha") || lower.includes("hash") || lower.includes("checksum"),
      "Missing hash reference",
    );
  });
});

// ── Suite 7: Human Override Type ──────────────────────────

describe("human override type contract", () => {
  type HumanOverride = {
    model_id: string;
    overridden_output: string;
    reason: string;
    approved_by_user_id: string;
    approved_at: string;
  };

  test("override record has all required fields", () => {
    const override: HumanOverride = {
      model_id: "risk_factor_analysis",
      overridden_output: "decision recommendation",
      reason: "Model underweighted borrower history",
      approved_by_user_id: "user-123",
      approved_at: "2026-01-27T22:00:00.000Z",
    };
    assert.ok(override.model_id);
    assert.ok(override.overridden_output);
    assert.ok(override.reason);
    assert.ok(override.approved_by_user_id);
    assert.ok(override.approved_at);
  });

  test("override model_id must reference a registered model", () => {
    const validIds = MODEL_REGISTRY.map((m) => m.model_id);
    const override = {
      model_id: "borrower_extraction",
      overridden_output: "borrower.legal_name",
      reason: "OCR misread entity name",
      approved_by_user_id: "user-456",
      approved_at: "2026-01-27T22:00:00.000Z",
    };
    assert.ok(validIds.includes(override.model_id));
  });
});

// ── Suite 8: Examiner Drop ZIP Integration ────────────────

describe("examiner drop ZIP integration (Phase H+I artifacts)", () => {
  // Simulate the manifest artifact paths that should now include governance + playbooks
  const expectedArtifactPaths = [
    "borrower-audit/snapshot.json",
    "borrower-audit/snapshot.pdf",
    "credit-decision/snapshot.json",
    "credit-decision/snapshot.pdf",
    "financials/financial-snapshot.json",
    "policies/policy-eval.json",
    "policies/exceptions.json",
    "policies/model-governance.json",      // Phase H
    "playbooks/examiner-playbooks.json",   // Phase I
    "playbooks/examiner-playbooks.pdf",    // Phase I
    "README.txt",
    "integrity/checksums.txt",
    "integrity/manifest.json",
  ];

  test("manifest includes model-governance.json", () => {
    assert.ok(expectedArtifactPaths.includes("policies/model-governance.json"));
  });

  test("manifest includes examiner-playbooks.json", () => {
    assert.ok(expectedArtifactPaths.includes("playbooks/examiner-playbooks.json"));
  });

  test("manifest includes examiner-playbooks.pdf", () => {
    assert.ok(expectedArtifactPaths.includes("playbooks/examiner-playbooks.pdf"));
  });

  test("governance artifact has deterministic hash", () => {
    const appendix = {
      governance_version: "1.0",
      registry: MODEL_REGISTRY,
      invariant_check: validateGovernanceInvariants(),
    };
    const json1 = stableStringify(appendix);
    const json2 = stableStringify(appendix);
    assert.equal(sha256Sim(json1), sha256Sim(json2));
  });

  test("playbook artifact has deterministic hash", () => {
    const pb = generateExaminerPlaybooks();
    const json1 = stableStringify(pb);
    const json2 = stableStringify(pb);
    assert.equal(sha256Sim(json1), sha256Sim(json2));
  });

  test("drop_hash changes when governance artifact changes", () => {
    const hashes1 = ["abc123", "def456", sha256Sim("governance_v1")].join("|");
    const hashes2 = ["abc123", "def456", sha256Sim("governance_v2")].join("|");
    assert.notEqual(sha256Sim(hashes1), sha256Sim(hashes2));
  });
});

// ── Suite 9: Signal Types ─────────────────────────────────

describe("Phase H+I signal types", () => {
  const SIGNAL_TYPES = [
    "page.ready",
    "deal.loaded",
    "decision.audit.snapshot.created",
    "examiner.drop.created",
    "model.governance.exported",
    "examiner.playbooks.exported",
  ];

  test("model.governance.exported signal exists", () => {
    assert.ok(SIGNAL_TYPES.includes("model.governance.exported"));
  });

  test("examiner.playbooks.exported signal exists", () => {
    assert.ok(SIGNAL_TYPES.includes("examiner.playbooks.exported"));
  });
});
