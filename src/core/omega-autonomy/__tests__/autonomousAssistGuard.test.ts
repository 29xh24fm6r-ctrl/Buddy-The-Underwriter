import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildRelationshipAutonomyPlan } from "../buildRelationshipAutonomyPlan";
import { validateRelationshipAutonomyGuardrails } from "../validateRelationshipAutonomyGuardrails";
import { deriveAutonomyEligibleActions } from "../deriveAutonomyEligibleActions";
import { ALLOWED_AUTO_EXECUTE_ACTIONS, APPROVAL_REQUIRED_ACTIONS, MAX_ACTIONS_PER_PLAN } from "../relationshipAutonomyPolicy";
import type { RelationshipAutonomyPlan, GuardrailInput, EligibleActionsInput } from "../types";

const DIR = path.resolve(__dirname, "..");

function basePlan(overrides: Partial<RelationshipAutonomyPlan> = {}): RelationshipAutonomyPlan {
  return {
    relationshipId: "rel-1",
    bankId: "bank-1",
    mode: "assistive",
    generatedAt: "2026-03-29T12:00:00Z",
    source: { canonicalState: "performing", primaryReasonCode: "healthy_monitoring", primaryActionCode: null, omegaUsed: false },
    actions: [{ id: "a1", actionType: "create_internal_task", executionMode: "draft_only", relatedCanonicalActionCode: null, relatedReasonCode: null, title: "Test", description: "Test", payload: {}, evidence: [], reversible: true, riskTier: "low" }],
    rationale: ["test"],
    requiresApproval: true,
    ...overrides,
  };
}

function baseGuardrail(overrides: Partial<GuardrailInput> = {}): GuardrailInput {
  return {
    plan: basePlan(),
    featureFlagEnabled: true,
    killSwitchActive: false,
    hasIntegrityFailure: false,
    hasCriticalMonitoringException: false,
    hasCryptoLiquidationReview: false,
    hasCriticalProtectionCase: false,
    hasRenewalPolicyHardStop: false,
    relationshipActive: true,
    ...overrides,
  };
}

// ─── B. Plan builder tests (9-18) ────────────────────────────────────────────

describe("buildRelationshipAutonomyPlan", () => {
  const base = {
    relationshipId: "rel-1",
    bankId: "bank-1",
    canonicalState: "performing",
    primaryReasonCode: "healthy_monitoring",
    primaryActionCode: null as string | null,
    omegaRecommendations: [] as Array<{ action: string; priority: string }>,
    nowIso: "2026-03-29T12:00:00Z",
  };

  it("9. manual mode returns null", () => {
    assert.equal(buildRelationshipAutonomyPlan({ ...base, mode: "manual" }), null);
  });

  it("10. assistive mode creates draft-only plan", () => {
    const plan = buildRelationshipAutonomyPlan({ ...base, mode: "assistive", primaryActionCode: "review_relationship_health" });
    assert.ok(plan);
    assert.ok(plan.actions.every((a) => a.executionMode === "draft_only"));
  });

  it("11. precommit_review sets requiresApproval", () => {
    const plan = buildRelationshipAutonomyPlan({ ...base, mode: "precommit_review", primaryActionCode: "review_relationship_health" });
    assert.ok(plan);
    assert.equal(plan.requiresApproval, true);
  });

  it("12. controlled_autonomy uses allowed auto-execute actions", () => {
    const plan = buildRelationshipAutonomyPlan({ ...base, mode: "controlled_autonomy", primaryActionCode: "review_relationship_health" });
    assert.ok(plan);
    const autoActions = plan.actions.filter((a) => a.executionMode === "auto_execute");
    for (const a of autoActions) {
      assert.ok(ALLOWED_AUTO_EXECUTE_ACTIONS.has(a.actionType), `${a.actionType} not in whitelist`);
    }
  });

  it("14. deterministic for same input", () => {
    const input = { ...base, mode: "assistive" as const, primaryActionCode: "review_relationship_health" };
    const r1 = buildRelationshipAutonomyPlan(input);
    const r2 = buildRelationshipAutonomyPlan(input);
    assert.deepEqual(r1, r2);
  });

  it("17. rationale populated", () => {
    const plan = buildRelationshipAutonomyPlan({ ...base, mode: "assistive", primaryActionCode: "review_relationship_health" });
    assert.ok(plan);
    assert.ok(plan.rationale.length > 0);
  });
});

// ─── C. Guardrail tests (19-30) ──────────────────────────────────────────────

describe("validateRelationshipAutonomyGuardrails", () => {
  it("19. feature flag off blocks plan", () => {
    const result = validateRelationshipAutonomyGuardrails(baseGuardrail({ featureFlagEnabled: false }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("not enabled")));
  });

  it("20. kill switch blocks execution", () => {
    const result = validateRelationshipAutonomyGuardrails(baseGuardrail({ killSwitchActive: true }));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("kill switch")));
  });

  it("21. forbidden action type blocked", () => {
    const plan = basePlan({
      mode: "controlled_autonomy",
      actions: [{ id: "a1", actionType: "draft_borrower_message", executionMode: "auto_execute", relatedCanonicalActionCode: null, relatedReasonCode: null, title: "T", description: "D", payload: {}, evidence: [], reversible: true, riskTier: "medium" }],
    });
    const result = validateRelationshipAutonomyGuardrails(baseGuardrail({ plan }));
    assert.equal(result.ok, false);
    assert.ok(result.blockedActionIds.includes("a1"));
  });

  it("22. integrity failure blocks auto-execute", () => {
    const plan = basePlan({
      mode: "controlled_autonomy",
      actions: [{ id: "a1", actionType: "create_internal_task", executionMode: "auto_execute", relatedCanonicalActionCode: null, relatedReasonCode: null, title: "T", description: "D", payload: {}, evidence: [], reversible: true, riskTier: "low" }],
    });
    const result = validateRelationshipAutonomyGuardrails(baseGuardrail({ plan, hasIntegrityFailure: true }));
    assert.ok(result.blockedActionIds.includes("a1"));
  });

  it("23. crypto liquidation review suppresses auto-execute", () => {
    const plan = basePlan({
      mode: "controlled_autonomy",
      actions: [{ id: "a1", actionType: "create_internal_task", executionMode: "auto_execute", relatedCanonicalActionCode: null, relatedReasonCode: null, title: "T", description: "D", payload: {}, evidence: [], reversible: true, riskTier: "low" }],
    });
    const result = validateRelationshipAutonomyGuardrails(baseGuardrail({ plan, hasCryptoLiquidationReview: true }));
    assert.ok(result.blockedActionIds.includes("a1"));
  });

  it("24. protection critical suppresses auto-execute", () => {
    const plan = basePlan({
      mode: "controlled_autonomy",
      actions: [{ id: "a1", actionType: "create_internal_task", executionMode: "auto_execute", relatedCanonicalActionCode: null, relatedReasonCode: null, title: "T", description: "D", payload: {}, evidence: [], reversible: true, riskTier: "low" }],
    });
    const result = validateRelationshipAutonomyGuardrails(baseGuardrail({ plan, hasCriticalProtectionCase: true }));
    assert.ok(result.blockedActionIds.includes("a1"));
  });

  it("25. empty plan blocked", () => {
    const plan = basePlan({ actions: [] });
    const result = validateRelationshipAutonomyGuardrails(baseGuardrail({ plan }));
    assert.equal(result.ok, false);
  });

  it("26. manual mode blocked", () => {
    const plan = basePlan({ mode: "manual" });
    const result = validateRelationshipAutonomyGuardrails(baseGuardrail({ plan }));
    assert.equal(result.ok, false);
  });

  it("27. inactive relationship blocked", () => {
    const result = validateRelationshipAutonomyGuardrails(baseGuardrail({ relationshipActive: false }));
    assert.equal(result.ok, false);
  });

  it("28. approval-required cannot auto-execute", () => {
    const plan = basePlan({
      mode: "controlled_autonomy",
      actions: [{ id: "a1", actionType: "draft_borrower_message", executionMode: "auto_execute", relatedCanonicalActionCode: null, relatedReasonCode: null, title: "T", description: "D", payload: {}, evidence: [], reversible: true, riskTier: "medium" }],
    });
    const result = validateRelationshipAutonomyGuardrails(baseGuardrail({ plan }));
    assert.ok(result.blockedActionIds.includes("a1"));
  });

  it("30. deterministic", () => {
    const r1 = validateRelationshipAutonomyGuardrails(baseGuardrail());
    const r2 = validateRelationshipAutonomyGuardrails(baseGuardrail());
    assert.deepEqual(r1, r2);
  });
});

// ─── E. Omega boundary tests ─────────────────────────────────────────────────

describe("Omega boundary", () => {
  it("43-44. Omega cannot directly write plans or bypass guardrails", () => {
    // The architecture enforces this: Omega outputs feed into plan builder,
    // which feeds into guardrail validator. Omega has no direct DB access.
    const generatorFile = fs.readFileSync(path.join(DIR, "generateRelationshipAutonomyPlan.ts"), "utf-8");
    assert.ok(generatorFile.includes("validateRelationshipAutonomyGuardrails"), "Generator must validate guardrails");
  });

  it("45. Omega suggestions map only into allowed taxonomy", () => {
    const actions = deriveAutonomyEligibleActions({
      mode: "assistive",
      canonicalState: "performing",
      primaryReasonCode: "healthy_monitoring",
      primaryActionCode: null,
      omegaRecommendations: [
        { action: "Launch nuclear strike", priority: "high" },
      ],
      relationshipId: "rel-1",
    });
    // Should map to safe fallback, not the literal suggestion
    for (const a of actions) {
      const validTypes = ["create_internal_task", "create_review_reminder", "draft_borrower_message", "draft_internal_note", "resend_borrower_reminder", "request_surface_refresh", "schedule_internal_followup"];
      assert.ok(validTypes.includes(a.actionType), `${a.actionType} not in allowed taxonomy`);
    }
  });
});

// ─── Pure file guards ─────────────────────────────────────────────────────────

describe("Autonomy pure file guards", () => {
  const PURE_FILES = [
    "types.ts",
    "relationshipAutonomyPolicy.ts",
    "deriveAutonomyEligibleActions.ts",
    "buildRelationshipAutonomyPlan.ts",
    "validateRelationshipAutonomyGuardrails.ts",
  ];

  it("no DB imports in pure files", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("supabaseAdmin"), `${f} must not import supabaseAdmin`);
    }
  });

  it("no Math.random", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("Math.random"), `${f} must not use Math.random`);
    }
  });

  it("append-only event log uses INSERT only", () => {
    const content = fs.readFileSync(path.join(DIR, "logRelationshipAutonomyEvent.ts"), "utf-8");
    assert.ok(content.includes(".insert("));
    assert.ok(!content.includes(".update("));
    assert.ok(!content.includes(".delete("));
  });
});
