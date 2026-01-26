/**
 * Buddy Autonomous Research Planner - Invariant Tests
 *
 * Tests the core planning invariants:
 * 1. NAICS code triggers industry research
 * 2. Principals >= 20% trigger management research
 * 3. Growth purpose triggers market demand research
 * 4. Regulated industry triggers regulatory research
 * 5. No duplicate missions proposed
 * 6. No mission proposed without supporting rationale
 * 7. Planner is deterministic (same input → same output)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extractEntitySignals,
  hasMinimumSignals,
  summarizeSignals,
} from "../research/planner/extractEntitySignals";
import {
  deriveResearchIntent,
  summarizePlan,
} from "../research/planner/deriveResearchIntent";
import type {
  PlannerInput,
  EntitySignals,
  ExistingMission,
} from "../research/planner/types";

// ============================================================================
// Entity Signal Extraction Tests
// ============================================================================

describe("Entity Signal Extraction", () => {
  it("should extract NAICS code from entity metadata", () => {
    const signals = extractEntitySignals(
      { id: "deal-1" },
      [
        {
          id: "ent-1",
          name: "Acme Construction",
          entity_kind: "OPCO",
          meta: { naics_code: "236115" },
        },
      ],
      []
    );

    assert.equal(signals.naics_code, "236115");
  });

  it("should extract EIN from OPCO entity", () => {
    const signals = extractEntitySignals(
      { id: "deal-1" },
      [
        {
          id: "ent-1",
          name: "Acme Construction",
          entity_kind: "OPCO",
          ein: "12-3456789",
        },
      ],
      []
    );

    assert.equal(signals.ein, "12-3456789");
  });

  it("should extract principals from PERSON entities with >= 20% ownership", () => {
    const signals = extractEntitySignals(
      { id: "deal-1" },
      [
        {
          id: "ent-1",
          name: "Acme Construction",
          entity_kind: "OPCO",
        },
        {
          id: "ent-2",
          name: "John Smith",
          entity_kind: "PERSON",
          ownership_percent: 51,
        },
        {
          id: "ent-3",
          name: "Jane Doe",
          entity_kind: "PERSON",
          ownership_percent: 25,
        },
        {
          id: "ent-4",
          name: "Minor Owner",
          entity_kind: "PERSON",
          ownership_percent: 10, // Below threshold
        },
      ],
      []
    );

    assert.equal(signals.principals?.length, 2);
    assert.equal(signals.principals![0].name, "John Smith");
    assert.equal(signals.principals![0].ownership_pct, 51);
    assert.equal(signals.principals![1].name, "Jane Doe");
  });

  it("should identify minimum signals for planning", () => {
    // With NAICS
    assert.ok(hasMinimumSignals({ naics_code: "236" }));

    // With principals
    assert.ok(hasMinimumSignals({ principals: [{ name: "John", ownership_pct: 51 }] }));

    // Without either
    assert.ok(!hasMinimumSignals({}));
    assert.ok(!hasMinimumSignals({ ein: "12-3456789" })); // EIN alone not enough
  });

  it("should generate summary of signals", () => {
    const summary = summarizeSignals({
      legal_company_name: "Acme Corp",
      naics_code: "236",
      principals: [{ name: "John", ownership_pct: 51 }],
    });

    assert.ok(summary.length > 0);
    assert.ok(summary.some((s) => s.includes("Acme Corp")));
    assert.ok(summary.some((s) => s.includes("236")));
    assert.ok(summary.some((s) => s.includes("John")));
  });
});

// ============================================================================
// Research Intent Derivation Tests
// ============================================================================

describe("Research Intent Derivation", () => {
  it("should propose industry research when NAICS code present", () => {
    const input = createPlannerInput({
      entity_signals: { naics_code: "236" },
    });

    const output = deriveResearchIntent(input);

    assert.ok(output.ok);
    const industryMission = output.proposed_missions.find(
      (m) => m.mission_type === "industry_landscape"
    );
    assert.ok(industryMission, "Should propose industry_landscape mission");
    assert.ok(industryMission!.rationale.includes("NAICS"));
    assert.ok(industryMission!.supporting_fact_ids !== undefined);
  });

  it("should NOT propose industry research without NAICS code", () => {
    const input = createPlannerInput({
      entity_signals: { legal_company_name: "Acme Corp" }, // No NAICS
    });

    const output = deriveResearchIntent(input);

    assert.ok(output.ok);
    const industryMission = output.proposed_missions.find(
      (m) => m.mission_type === "industry_landscape"
    );
    assert.ok(!industryMission, "Should NOT propose industry_landscape without NAICS");
  });

  it("should NOT propose duplicate missions", () => {
    const input = createPlannerInput({
      entity_signals: { naics_code: "236" },
      existing_missions: [
        {
          id: "mission-1",
          mission_type: "industry_landscape",
          subject: { naics_code: "236" },
          status: "complete",
          completed_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    const output = deriveResearchIntent(input);

    const industryMissions = output.proposed_missions.filter(
      (m) => m.mission_type === "industry_landscape"
    );
    assert.equal(industryMissions.length, 0, "Should not propose completed mission again");
  });

  it("should propose management research when principals present", () => {
    const input = createPlannerInput({
      entity_signals: {
        naics_code: "236",
        legal_company_name: "Acme Construction",
        principals: [
          { name: "John Smith", ownership_pct: 51 },
          { name: "Jane Doe", ownership_pct: 25 },
        ],
      },
      underwriting_stance: "ready_for_underwriting",
    });

    const output = deriveResearchIntent(input);

    const mgmtMission = output.proposed_missions.find(
      (m) => m.mission_type === "management_backgrounds"
    );
    assert.ok(mgmtMission, "Should propose management_backgrounds mission");
    assert.ok(mgmtMission!.rationale.includes("John Smith"));
    assert.ok(mgmtMission!.rationale.includes("51%"));
  });

  it("should NOT propose management research without principals", () => {
    const input = createPlannerInput({
      entity_signals: { naics_code: "236" },
    });

    const output = deriveResearchIntent(input);

    const mgmtMission = output.proposed_missions.find(
      (m) => m.mission_type === "management_backgrounds"
    );
    assert.ok(!mgmtMission, "Should NOT propose management without principals");
  });

  it("should propose market demand for growth purpose deals", () => {
    const input = createPlannerInput({
      entity_signals: {
        naics_code: "722",
        headquarters_state: "CA",
      },
      deal_purpose: "expansion into new markets",
    });

    const output = deriveResearchIntent(input);

    const marketMission = output.proposed_missions.find(
      (m) => m.mission_type === "market_demand"
    );
    assert.ok(marketMission, "Should propose market_demand for expansion deals");
    assert.ok(marketMission!.rationale.toLowerCase().includes("expansion"));
  });

  it("should NOT propose market demand for non-growth purposes", () => {
    const input = createPlannerInput({
      entity_signals: {
        naics_code: "722",
        headquarters_state: "CA",
      },
      deal_purpose: "equipment refinancing",
    });

    const output = deriveResearchIntent(input);

    const marketMission = output.proposed_missions.find(
      (m) => m.mission_type === "market_demand"
    );
    assert.ok(!marketMission, "Should NOT propose market_demand for refinancing");
  });

  it("should propose regulatory research for regulated industries", () => {
    const input = createPlannerInput({
      entity_signals: {
        naics_code: "621", // Healthcare - regulated
      },
    });

    const output = deriveResearchIntent(input);

    const regMission = output.proposed_missions.find(
      (m) => m.mission_type === "regulatory_environment"
    );
    assert.ok(regMission, "Should propose regulatory research for healthcare");
    assert.ok(regMission!.rationale.includes("regulated"));
  });

  it("should propose regulatory research for multi-state operations", () => {
    const input = createPlannerInput({
      entity_signals: {
        naics_code: "236", // Construction - not heavily regulated
        operating_states: ["CA", "NV", "AZ"],
      },
    });

    const output = deriveResearchIntent(input);

    const regMission = output.proposed_missions.find(
      (m) => m.mission_type === "regulatory_environment"
    );
    assert.ok(regMission, "Should propose regulatory for multi-state");
    assert.ok(regMission!.rationale.includes("3 states"));
  });

  it("should be deterministic - same input produces same output", () => {
    const input = createPlannerInput({
      entity_signals: {
        naics_code: "236",
        legal_company_name: "Acme Corp",
        principals: [{ name: "John", ownership_pct: 51 }],
        operating_states: ["CA", "NV"],
      },
      deal_purpose: "expansion",
      underwriting_stance: "ready_for_underwriting",
    });

    const output1 = deriveResearchIntent(input);
    const output2 = deriveResearchIntent(input);

    assert.equal(output1.proposed_missions.length, output2.proposed_missions.length);
    for (let i = 0; i < output1.proposed_missions.length; i++) {
      assert.equal(
        output1.proposed_missions[i].mission_type,
        output2.proposed_missions[i].mission_type
      );
      assert.equal(
        output1.proposed_missions[i].priority,
        output2.proposed_missions[i].priority
      );
      assert.equal(
        output1.proposed_missions[i].rationale,
        output2.proposed_missions[i].rationale
      );
    }
  });

  it("should order missions by priority", () => {
    const input = createPlannerInput({
      entity_signals: {
        naics_code: "621", // Regulated healthcare
        headquarters_state: "CA",
        principals: [{ name: "John", ownership_pct: 51 }],
        operating_states: ["CA", "NV"],
      },
      deal_purpose: "expansion",
      underwriting_stance: "ready_for_underwriting",
    });

    const output = deriveResearchIntent(input);

    // Should be sorted by priority
    for (let i = 1; i < output.proposed_missions.length; i++) {
      assert.ok(
        output.proposed_missions[i].priority >= output.proposed_missions[i - 1].priority,
        "Missions should be sorted by priority"
      );
    }

    // Industry should come first (priority 1)
    if (output.proposed_missions.length > 0) {
      assert.equal(output.proposed_missions[0].mission_type, "industry_landscape");
    }
  });

  it("should include intent logs for all evaluated rules", () => {
    const input = createPlannerInput({
      entity_signals: { naics_code: "236" },
    });

    const output = deriveResearchIntent(input);

    assert.ok(output.intent_logs.length > 0, "Should have intent logs");

    // Each log should have required fields
    for (const log of output.intent_logs) {
      assert.ok(log.rule_name, "Intent log must have rule_name");
      assert.ok(log.rationale, "Intent log must have rationale");
      assert.ok(typeof log.confidence === "number", "Intent log must have confidence");
    }
  });

  it("should track gaps when prerequisites missing", () => {
    const input = createPlannerInput({
      entity_signals: {}, // No signals at all
    });

    const output = deriveResearchIntent(input);

    assert.ok(output.gaps_identified.length > 0, "Should identify gaps");
    assert.ok(
      output.gaps_identified.some((g) => g.includes("NAICS")),
      "Should mention NAICS gap"
    );
  });
});

describe("Plan Summary", () => {
  it("should generate human-readable summary", () => {
    const input = createPlannerInput({
      entity_signals: {
        naics_code: "236",
        principals: [{ name: "John", ownership_pct: 51 }],
      },
      underwriting_stance: "ready_for_underwriting",
    });

    const output = deriveResearchIntent(input);
    const summary = summarizePlan(output);

    assert.ok(summary.length > 0);
    assert.ok(summary.includes("Buddy"));
    assert.ok(summary.includes("Industry"));
  });

  it("should indicate when no research needed", () => {
    const input = createPlannerInput({
      entity_signals: { naics_code: "236" },
      existing_missions: [
        {
          id: "m1",
          mission_type: "industry_landscape",
          subject: {},
          status: "complete",
        },
        {
          id: "m2",
          mission_type: "competitive_analysis",
          subject: {},
          status: "complete",
        },
      ],
    });

    const output = deriveResearchIntent(input);
    const summary = summarizePlan(output);

    // If no missions proposed, should indicate that
    if (output.proposed_missions.length === 0) {
      assert.ok(summary.includes("No research"));
    }
  });
});

// ============================================================================
// Hard Invariants
// ============================================================================

describe("Planner Invariants", () => {
  it("INVARIANT: No mission proposed without rationale", () => {
    const inputs = [
      createPlannerInput({ entity_signals: { naics_code: "236" } }),
      createPlannerInput({
        entity_signals: { naics_code: "621", principals: [{ name: "A", ownership_pct: 51 }] },
      }),
      createPlannerInput({
        entity_signals: { naics_code: "722", operating_states: ["CA", "NV"] },
        deal_purpose: "expansion",
      }),
    ];

    for (const input of inputs) {
      const output = deriveResearchIntent(input);

      for (const mission of output.proposed_missions) {
        assert.ok(
          mission.rationale && mission.rationale.length > 0,
          `Mission ${mission.mission_type} must have rationale`
        );
      }
    }
  });

  it("INVARIANT: Every intent log has rule_name and version", () => {
    const input = createPlannerInput({
      entity_signals: {
        naics_code: "236",
        principals: [{ name: "John", ownership_pct: 51 }],
      },
      deal_purpose: "expansion",
    });

    const output = deriveResearchIntent(input);

    for (const log of output.intent_logs) {
      assert.ok(log.rule_name, "Intent log must have rule_name");
      assert.ok(typeof log.rule_version === "number", "Intent log must have rule_version");
    }
  });

  it("INVARIANT: Confidence is always between 0 and 1", () => {
    const input = createPlannerInput({
      entity_signals: {
        naics_code: "621",
        principals: [{ name: "John", ownership_pct: 51 }],
        operating_states: ["CA", "NV", "AZ"],
      },
      deal_purpose: "expansion",
      underwriting_stance: "ready_for_underwriting",
    });

    const output = deriveResearchIntent(input);

    for (const mission of output.proposed_missions) {
      assert.ok(mission.confidence >= 0 && mission.confidence <= 1, "Confidence must be 0-1");
    }

    for (const log of output.intent_logs) {
      assert.ok(log.confidence >= 0 && log.confidence <= 1, "Log confidence must be 0-1");
    }
  });

  it("INVARIANT: Priority is positive integer", () => {
    const input = createPlannerInput({
      entity_signals: {
        naics_code: "621",
        operating_states: ["CA", "NV"],
      },
      deal_purpose: "expansion",
    });

    const output = deriveResearchIntent(input);

    for (const mission of output.proposed_missions) {
      assert.ok(
        Number.isInteger(mission.priority) && mission.priority > 0,
        "Priority must be positive integer"
      );
    }
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function createPlannerInput(overrides: Partial<PlannerInput>): PlannerInput {
  return {
    deal_id: "test-deal-001",
    entity_signals: {},
    extracted_facts: [],
    existing_missions: [],
    trigger_event: "manual_request",
    ...overrides,
  };
}
