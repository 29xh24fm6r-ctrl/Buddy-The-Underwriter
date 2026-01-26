/**
 * Research Hardening Tests
 *
 * Tests for the production-grade research engine features:
 * - Playbook configuration
 * - Source registry and allowlist
 * - Mission integrity assertions
 * - Orchestration (run_key, timeboxing)
 * - Autonomy levels
 * - Explainability graph
 * - Industry underwriting context
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

// Playbook
import {
  MISSION_DEFINITIONS,
  SOURCE_CLASS_CONFIG,
  FACT_TYPE_CONFIG,
  INFERENCE_TYPE_CONFIG,
  getMissionDefinition,
  getMissionTypesInOrder,
  getSourceClassConfig,
  isRiskIndicator,
  getRiskIndicatorInferenceTypes,
} from "../research/playbook";

// Source Registry
import {
  lookupSource,
  getRegistryEntry,
  getAllRegistryEntries,
  getSourceTrustScore,
  logBlockedSource,
  getRecentBlockedSources,
  clearBlockedSourceLog,
} from "../research/sources/registry";

// Integrity
import {
  assertMissionIntegrity,
  buildExplainabilityGraph,
  validateExplainabilityGraph,
  type MissionData,
} from "../research/integrity";

// Orchestration
import {
  generateRunKey,
  getTimeboxConfig,
  createTimeboxState,
  checkTimeboxLimits,
  recordSourceFetched,
  startFetchPhase,
} from "../research/orchestration";

// Autonomy
import {
  getEffectiveAutonomyLevel,
  setAutonomyLevel,
  shouldAutoExecute,
  isPlanningEnabled,
  resetAutonomyStore,
} from "../research/planner/autonomy";

// Industry Underwriting Context
import {
  deriveIndustryUnderwritingContext,
  type UnderwritingContext,
} from "../research/deriveIndustryUnderwritingContext";

import type {
  ResearchMission,
  ResearchSource,
  ResearchFact,
  ResearchInference,
  NarrativeSection,
} from "../research/types";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockMission(overrides: Partial<ResearchMission> = {}): ResearchMission {
  return {
    id: "mission-001",
    deal_id: "deal-001",
    mission_type: "industry_landscape",
    subject: { naics_code: "236" },
    depth: "committee",
    status: "complete",
    sources_count: 3,
    facts_count: 10,
    inferences_count: 5,
    created_at: "2024-01-01T00:00:00Z",
    completed_at: "2024-01-01T00:01:00Z",
    ...overrides,
  };
}

function createMockSource(id: string, overrides: Partial<ResearchSource> = {}): ResearchSource {
  return {
    id,
    mission_id: "mission-001",
    source_class: "government",
    source_name: "Census CBP",
    source_url: "https://api.census.gov/data/test",
    raw_content: {},
    checksum: "abc123def456",
    retrieved_at: "2024-01-01T00:00:10Z",
    http_status: 200,
    fetch_duration_ms: 500,
    ...overrides,
  };
}

function createMockFact(
  id: string,
  factType: string,
  sourceId: string,
  overrides: Partial<ResearchFact> = {}
): ResearchFact {
  return {
    id,
    mission_id: "mission-001",
    source_id: sourceId,
    fact_type: factType as ResearchFact["fact_type"],
    value: { value: 100, unit: "test" },
    confidence: 0.8,
    extracted_by: "rule",
    extracted_at: "2024-01-01T00:00:20Z",
    ...overrides,
  };
}

function createMockInference(
  id: string,
  inferenceType: string,
  inputFactIds: string[],
  overrides: Partial<ResearchInference> = {}
): ResearchInference {
  return {
    id,
    mission_id: "mission-001",
    inference_type: inferenceType as ResearchInference["inference_type"],
    conclusion: "Test conclusion",
    input_fact_ids: inputFactIds,
    confidence: 0.75,
    reasoning: "Test reasoning",
    created_at: "2024-01-01T00:00:30Z",
    ...overrides,
  };
}

// ============================================================================
// Playbook Tests
// ============================================================================

describe("Research Playbook", () => {
  it("should have all 8 mission types defined", () => {
    const missionTypes = Object.keys(MISSION_DEFINITIONS);
    assert.strictEqual(missionTypes.length, 8);
    assert.ok(missionTypes.includes("industry_landscape"));
    assert.ok(missionTypes.includes("lender_fit_analysis"));
    assert.ok(missionTypes.includes("scenario_stress"));
  });

  it("should return mission types in priority order", () => {
    const ordered = getMissionTypesInOrder();
    assert.strictEqual(ordered[0], "industry_landscape"); // Priority 1
    assert.strictEqual(ordered[7], "scenario_stress"); // Priority 8
  });

  it("should have source class configurations", () => {
    const govConfig = getSourceClassConfig("government");
    assert.strictEqual(govConfig.trust_score, 0.95);
    assert.ok(govConfig.rate_limit_rpm > 0);
  });

  it("should identify risk indicator inference types", () => {
    const riskIndicators = getRiskIndicatorInferenceTypes();
    assert.ok(riskIndicators.includes("competitive_intensity"));
    assert.ok(riskIndicators.includes("regulatory_risk_level"));
    assert.ok(riskIndicators.includes("stress_resilience"));
    assert.ok(!riskIndicators.includes("other"));
  });

  it("should have timebox limits for each mission type", () => {
    for (const type of getMissionTypesInOrder()) {
      const def = getMissionDefinition(type);
      assert.ok(def.max_sources > 0, `${type} should have max_sources`);
      assert.ok(def.max_fetch_seconds > 0, `${type} should have max_fetch_seconds`);
    }
  });
});

// ============================================================================
// Source Registry Tests
// ============================================================================

describe("Source Registry", () => {
  beforeEach(() => {
    clearBlockedSourceLog();
  });

  it("should allow known government sources", () => {
    const result = lookupSource("https://api.census.gov/data/2021/cbp?get=test");
    assert.ok(result.allowed);
    assert.ok(result.entry);
    assert.strictEqual(result.entry!.source_class, "government");
  });

  it("should block unknown domains", () => {
    const result = lookupSource("https://unknown-site.com/data");
    assert.ok(!result.allowed);
    assert.ok(result.reason?.includes("not in allowlist"));
  });

  it("should block disallowed paths on known domains", () => {
    const result = lookupSource("https://api.census.gov/admin/secret");
    assert.ok(!result.allowed);
    assert.ok(result.reason?.includes("Path not allowed"));
  });

  it("should log blocked sources", () => {
    lookupSource("https://blocked.example.com/data");
    logBlockedSource("https://blocked.example.com/data", "Domain not in allowlist");

    const blocked = getRecentBlockedSources(10);
    assert.ok(blocked.length > 0);
    assert.strictEqual(blocked[blocked.length - 1].domain, "blocked.example.com");
  });

  it("should return trust scores", () => {
    const govScore = getSourceTrustScore("https://api.census.gov/data/test");
    const unknownScore = getSourceTrustScore("https://unknown.com/test");

    assert.strictEqual(govScore, 0.95);
    assert.strictEqual(unknownScore, 0);
  });

  it("should have entries for all major government sources", () => {
    const entries = getAllRegistryEntries();
    const govEntries = entries.filter((e) => e.source_class === "government");

    assert.ok(govEntries.length >= 5);
    assert.ok(govEntries.some((e) => e.id === "census-api"));
    assert.ok(govEntries.some((e) => e.id === "bls-api"));
    assert.ok(govEntries.some((e) => e.id === "fred-api"));
  });
});

// ============================================================================
// Mission Integrity Tests
// ============================================================================

describe("Mission Integrity", () => {
  it("should pass for valid mission data", () => {
    const source = createMockSource("src-1");
    const fact = createMockFact("fact-1", "market_size", "src-1");
    const inference = createMockInference("inf-1", "growth_trajectory", ["fact-1"]);

    const data: MissionData = {
      mission: createMockMission(),
      sources: [source],
      facts: [fact],
      inferences: [inference],
      narrative: [
        {
          title: "Industry Landscape",
          sentences: [
            { text: "Test sentence.", citations: [{ type: "fact", id: "fact-1" }] },
          ],
        },
      ],
    };

    const result = assertMissionIntegrity(data);
    assert.ok(result.ok);
    assert.strictEqual(result.violations.length, 0);
  });

  it("should fail when no sources", () => {
    const data: MissionData = {
      mission: createMockMission(),
      sources: [],
      facts: [],
      inferences: [],
    };

    const result = assertMissionIntegrity(data);
    assert.ok(!result.ok);
    assert.ok(result.violations.some((v) => v.code === "NO_SOURCES"));
  });

  it("should fail when inference has no input_fact_ids", () => {
    const source = createMockSource("src-1");
    const inference = createMockInference("inf-1", "growth_trajectory", []);

    const data: MissionData = {
      mission: createMockMission(),
      sources: [source],
      facts: [],
      inferences: [inference],
    };

    const result = assertMissionIntegrity(data);
    assert.ok(!result.ok);
    assert.ok(result.violations.some((v) => v.code === "ORPHAN_INFERENCE"));
  });

  it("should fail when narrative cites unknown fact", () => {
    const source = createMockSource("src-1");

    const data: MissionData = {
      mission: createMockMission(),
      sources: [source],
      facts: [],
      inferences: [],
      narrative: [
        {
          title: "Test",
          sentences: [
            { text: "Long sentence that should have a citation but references unknown fact.", citations: [{ type: "fact", id: "unknown-fact" }] },
          ],
        },
      ],
    };

    const result = assertMissionIntegrity(data);
    assert.ok(!result.ok);
    assert.ok(result.violations.some((v) => v.code === "ORPHAN_CITATION"));
  });

  it("should warn about uncited long sentences", () => {
    const source = createMockSource("src-1");

    const data: MissionData = {
      mission: createMockMission(),
      sources: [source],
      facts: [],
      inferences: [],
      narrative: [
        {
          title: "Test",
          sentences: [
            { text: "This is a very long sentence that makes a substantial claim without any citation to back it up.", citations: [] },
          ],
        },
      ],
    };

    const result = assertMissionIntegrity(data);
    assert.ok(!result.ok);
    assert.ok(result.violations.some((v) => v.code === "UNCITED_SENTENCE"));
  });

  it("should fail when source missing checksum", () => {
    const source = createMockSource("src-1", { checksum: "" });

    const data: MissionData = {
      mission: createMockMission(),
      sources: [source],
      facts: [],
      inferences: [],
    };

    const result = assertMissionIntegrity(data);
    assert.ok(!result.ok);
    assert.ok(result.violations.some((v) => v.code === "MISSING_CHECKSUM"));
  });
});

// ============================================================================
// Explainability Graph Tests
// ============================================================================

describe("Explainability Graph", () => {
  it("should build complete graph", () => {
    const source = createMockSource("src-1");
    const fact = createMockFact("fact-1", "market_size", "src-1");
    const inference = createMockInference("inf-1", "growth_trajectory", ["fact-1"]);

    const data: MissionData = {
      mission: createMockMission(),
      sources: [source],
      facts: [fact],
      inferences: [inference],
      narrative: [
        {
          title: "Test",
          sentences: [
            { text: "Test.", citations: [{ type: "inference", id: "inf-1" }] },
          ],
        },
      ],
    };

    const graph = buildExplainabilityGraph(data);

    assert.ok(graph.nodes.length >= 4); // source + fact + inference + sentence
    assert.ok(graph.edges.length >= 3); // source->fact, fact->inference, inference->sentence
  });

  it("should validate graph for orphan edges", () => {
    const graph = {
      nodes: [{ id: "n1", type: "source" as const, label: "Test" }],
      edges: [{ from: "n1", to: "n2", type: "extracted_from" as const }],
    };

    const result = validateExplainabilityGraph(graph);
    assert.ok(!result.valid);
    assert.strictEqual(result.orphanEdges.length, 1);
  });
});

// ============================================================================
// Orchestration Tests
// ============================================================================

describe("Mission Orchestration", () => {
  it("should generate deterministic run keys", () => {
    const key1 = generateRunKey({
      deal_id: "deal-001",
      mission_type: "industry_landscape",
      subject: { naics_code: "236" },
      depth: "committee",
    });

    const key2 = generateRunKey({
      deal_id: "deal-001",
      mission_type: "industry_landscape",
      subject: { naics_code: "236" },
      depth: "committee",
    });

    assert.strictEqual(key1, key2);
  });

  it("should generate different keys for different inputs", () => {
    const key1 = generateRunKey({
      deal_id: "deal-001",
      mission_type: "industry_landscape",
      subject: { naics_code: "236" },
      depth: "committee",
    });

    const key2 = generateRunKey({
      deal_id: "deal-002", // Different deal
      mission_type: "industry_landscape",
      subject: { naics_code: "236" },
      depth: "committee",
    });

    assert.notStrictEqual(key1, key2);
  });

  it("should provide timebox config for mission types", () => {
    const config = getTimeboxConfig("industry_landscape");

    assert.ok(config.max_sources > 0);
    assert.ok(config.max_fetch_seconds > 0);
    assert.ok(config.max_extract_seconds > 0);
  });

  it("should track timebox state", () => {
    const config = getTimeboxConfig("industry_landscape");
    let state = createTimeboxState();

    // Not exceeded initially
    let check = checkTimeboxLimits(state, config);
    assert.ok(!check.exceeded);

    // Add sources until limit
    for (let i = 0; i < config.max_sources; i++) {
      state = recordSourceFetched(state);
    }

    check = checkTimeboxLimits(state, config);
    assert.ok(check.exceeded);
    assert.strictEqual(check.reason, "sources");
  });
});

// ============================================================================
// Autonomy Tests
// ============================================================================

describe("Autonomy Management", () => {
  beforeEach(() => {
    resetAutonomyStore();
  });

  afterEach(() => {
    resetAutonomyStore();
  });

  it("should return default autonomy level", () => {
    const settings = getEffectiveAutonomyLevel();
    assert.strictEqual(settings.level, "RECOMMEND");
    assert.strictEqual(settings.scope, "global");
  });

  it("should allow setting autonomy level", () => {
    const result = setAutonomyLevel({
      level: "AUTO_RUN",
      deal_id: "deal-001",
    });

    assert.ok(result.ok);

    const settings = getEffectiveAutonomyLevel("deal-001");
    assert.strictEqual(settings.level, "AUTO_RUN");
    assert.strictEqual(settings.scope, "deal");
  });

  it("should cascade from deal to bank to global", () => {
    setAutonomyLevel({ level: "OFF", bank_id: "bank-001" });

    // Bank level should apply
    const bankSettings = getEffectiveAutonomyLevel(undefined, "bank-001");
    assert.strictEqual(bankSettings.level, "OFF");

    // Deal overrides bank
    setAutonomyLevel({ level: "AUTO_RUN", deal_id: "deal-001" });
    const dealSettings = getEffectiveAutonomyLevel("deal-001", "bank-001");
    assert.strictEqual(dealSettings.level, "AUTO_RUN");
  });

  it("should correctly report auto-execute capability", () => {
    setAutonomyLevel({ level: "AUTO_RUN", deal_id: "deal-001" });
    setAutonomyLevel({ level: "RECOMMEND", deal_id: "deal-002" });
    setAutonomyLevel({ level: "OFF", deal_id: "deal-003" });

    assert.ok(shouldAutoExecute("deal-001"));
    assert.ok(!shouldAutoExecute("deal-002"));
    assert.ok(!shouldAutoExecute("deal-003"));
  });

  it("should correctly report planning enabled", () => {
    setAutonomyLevel({ level: "OFF", deal_id: "deal-001" });
    setAutonomyLevel({ level: "RECOMMEND", deal_id: "deal-002" });

    assert.ok(!isPlanningEnabled("deal-001"));
    assert.ok(isPlanningEnabled("deal-002"));
  });
});

// ============================================================================
// Industry Underwriting Context Tests
// ============================================================================

describe("Industry Underwriting Context", () => {
  it("should derive insights from favorable context", () => {
    const inferences: ResearchInference[] = [
      createMockInference("inf-1", "growth_trajectory", ["f1"], {
        conclusion: "POSITIVE growth trajectory with 5% annual increase.",
      }),
      createMockInference("inf-2", "demand_stability", ["f2"], {
        conclusion: "Stable demand fundamentals supported by demographic trends.",
      }),
      createMockInference("inf-3", "competitive_intensity", ["f3"], {
        conclusion: "LOW competitive intensity - fragmented market.",
      }),
    ];

    const context: UnderwritingContext = {
      stance: "favorable",
      checklist_completion_pct: 85,
    };

    const result = deriveIndustryUnderwritingContext(inferences, [], context);

    assert.ok(result.ok);
    assert.ok(result.insights.length > 0);
    assert.ok(result.overall_confidence > 0.5);
    assert.ok(result.key_strengths.length > 0);
  });

  it("should identify risks from challenging context", () => {
    const inferences: ResearchInference[] = [
      createMockInference("inf-1", "regulatory_risk_level", ["f1"], {
        conclusion: "HIGH regulatory burden with significant compliance costs.",
      }),
      createMockInference("inf-2", "stress_resilience", ["f2"], {
        conclusion: "LOW stress resilience - sensitive to economic downturns.",
      }),
    ];

    const context: UnderwritingContext = {
      stance: "cautious",
      checklist_completion_pct: 60,
    };

    const result = deriveIndustryUnderwritingContext(inferences, [], context);

    assert.ok(result.ok);
    assert.ok(result.key_risks.length > 0);
    assert.ok(result.key_risks.some((r) => r.includes("Regulatory")));
  });

  it("should recommend gathering documents when incomplete", () => {
    const context: UnderwritingContext = {
      stance: "insufficient_information",
      checklist_completion_pct: 30,
    };

    const result = deriveIndustryUnderwritingContext([], [], context);

    assert.strictEqual(result.recommended_action, "gather_more_documents");
  });

  it("should include citations in insights", () => {
    const inferences: ResearchInference[] = [
      createMockInference("inf-1", "growth_trajectory", ["f1"], {
        conclusion: "Growing industry with positive outlook.",
      }),
    ];

    const context: UnderwritingContext = {
      stance: "favorable",
      checklist_completion_pct: 80,
    };

    const result = deriveIndustryUnderwritingContext(inferences, [], context);

    assert.ok(result.ok);
    // At least one insight should have citations
    const citedInsight = result.insights.find((i) => i.citations.length > 0);
    assert.ok(citedInsight);
  });

  it("should recommend committee when all signals are positive", () => {
    const inferences: ResearchInference[] = [
      createMockInference("inf-1", "growth_trajectory", ["f1"], {
        conclusion: "Growing market with positive trajectory.",
      }),
      createMockInference("inf-2", "demand_stability", ["f2"], {
        conclusion: "Stable demand fundamentals.",
      }),
      createMockInference("inf-3", "stress_resilience", ["f3"], {
        conclusion: "HIGH stress resilience.",
      }),
    ];

    const context: UnderwritingContext = {
      stance: "favorable",
      checklist_completion_pct: 90,
      scenario_breakpoint: 25,
    };

    const result = deriveIndustryUnderwritingContext(inferences, [], context);

    assert.strictEqual(result.recommended_action, "proceed_to_committee");
  });
});
