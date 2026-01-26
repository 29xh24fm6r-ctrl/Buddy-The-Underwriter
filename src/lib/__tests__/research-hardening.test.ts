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

// ============================================================================
// Data Provenance Tests
// ============================================================================

import {
  calculateSourceProvenance,
  calculateFactProvenance,
  calculateInferenceProvenance,
  generateProvenanceReport,
  buildTrustChain,
  explainProvenance,
} from "../research/provenance";

describe("Data Provenance Scoring", () => {
  it("should calculate source provenance with trust score", () => {
    const source = createMockSource("src-1", {
      source_url: "https://api.census.gov/data/2021/cbp",
      source_class: "government",
      retrieved_at: new Date().toISOString(),
    });

    const provenance = calculateSourceProvenance(source);

    assert.ok(provenance.base_trust > 0.9); // Government sources have high trust
    assert.ok(provenance.freshness_factor > 0.9); // Recent data
    assert.ok(provenance.final_trust > 0.8);
  });

  it("should penalize old sources with lower freshness factor", () => {
    const oldDate = new Date();
    oldDate.setFullYear(oldDate.getFullYear() - 2); // 2 years ago

    const source = createMockSource("src-1", {
      source_url: "https://api.census.gov/data/2021/cbp",
      source_class: "government",
      retrieved_at: oldDate.toISOString(),
    });

    const provenance = calculateSourceProvenance(source);

    assert.ok(provenance.freshness_factor < 0.9); // Penalized for age
  });

  it("should calculate fact provenance combining source and extraction", () => {
    const source = createMockSource("src-1", {
      source_url: "https://api.census.gov/data/2021/cbp",
      retrieved_at: new Date().toISOString(),
    });
    const fact = createMockFact("fact-1", "market_size", "src-1", {
      confidence: 0.85,
      extracted_by: "rule",
    });

    const provenance = calculateFactProvenance(fact, source);

    assert.ok(provenance.extraction_factor === 0.95); // Rule-based extraction
    assert.ok(provenance.adjusted_confidence > 0);
    assert.ok(provenance.adjusted_confidence <= fact.confidence);
  });

  it("should apply lower extraction factor for model-based extraction", () => {
    const source = createMockSource("src-1", {
      source_url: "https://api.census.gov/data/2021/cbp",
      retrieved_at: new Date().toISOString(),
    });
    const ruleFact = createMockFact("fact-1", "market_size", "src-1", {
      confidence: 0.85,
      extracted_by: "rule",
    });
    const modelFact = createMockFact("fact-2", "market_size", "src-1", {
      confidence: 0.85,
      extracted_by: "model",
    });

    const ruleProv = calculateFactProvenance(ruleFact, source);
    const modelProv = calculateFactProvenance(modelFact, source);

    assert.ok(ruleProv.extraction_factor > modelProv.extraction_factor);
  });

  it("should calculate inference provenance with chain depth penalty", () => {
    const source = createMockSource("src-1", {
      source_url: "https://api.census.gov/data/2021/cbp",
      retrieved_at: new Date().toISOString(),
    });
    const fact = createMockFact("fact-1", "market_size", "src-1", {
      confidence: 0.85,
    });
    const inference = createMockInference("inf-1", "growth_trajectory", ["fact-1"], {
      confidence: 0.8,
    });

    const provenance = calculateInferenceProvenance(inference, [fact], [source]);

    assert.strictEqual(provenance.chain_depth, 2);
    assert.ok(provenance.adjusted_confidence <= inference.confidence);
  });

  it("should generate full provenance report", () => {
    const source = createMockSource("src-1", {
      source_url: "https://api.census.gov/data/2021/cbp",
      retrieved_at: new Date().toISOString(),
    });
    const fact = createMockFact("fact-1", "market_size", "src-1");
    const inference = createMockInference("inf-1", "growth_trajectory", ["fact-1"]);

    const report = generateProvenanceReport([source], [fact], [inference]);

    assert.strictEqual(report.sources.length, 1);
    assert.strictEqual(report.facts.length, 1);
    assert.strictEqual(report.inferences.length, 1);
    assert.ok(report.summary.avg_source_trust > 0);
  });

  it("should build trust chain for inference", () => {
    const source = createMockSource("src-1", {
      source_url: "https://api.census.gov/data/2021/cbp",
      retrieved_at: new Date().toISOString(),
    });
    const fact = createMockFact("fact-1", "market_size", "src-1");
    const inference = createMockInference("inf-1", "growth_trajectory", ["fact-1"]);

    const chain = buildTrustChain(inference, [fact], [source]);

    assert.ok(chain.length >= 3); // source, fact, inference
    assert.ok(chain.some((n) => n.type === "source"));
    assert.ok(chain.some((n) => n.type === "fact"));
    assert.ok(chain.some((n) => n.type === "inference"));
  });

  it("should generate human-readable provenance explanation", () => {
    const source = createMockSource("src-1", {
      source_url: "https://api.census.gov/data/2021/cbp",
      source_name: "Census CBP",
      retrieved_at: new Date().toISOString(),
    });
    const fact = createMockFact("fact-1", "market_size", "src-1");
    const inference = createMockInference("inf-1", "growth_trajectory", ["fact-1"]);

    const explanation = explainProvenance(inference, [fact], [source]);

    assert.ok(explanation.includes("Provenance Analysis"));
    assert.ok(explanation.includes("confidence"));
  });
});

// ============================================================================
// Conflict Resolver Tests
// ============================================================================

import {
  detectConflicts,
  detectFactConflict,
  mergeConflicts,
  getPreferredFact,
} from "../research/conflictResolver";

describe("Conflict Resolver", () => {
  it("should detect numeric disagreement between facts", () => {
    const source1 = createMockSource("src-1", {
      source_url: "https://api.census.gov/data/2021/cbp",
      source_name: "Census",
    });
    const source2 = createMockSource("src-2", {
      source_url: "https://api.bls.gov/data/test",
      source_name: "BLS",
    });

    const fact1 = createMockFact("fact-1", "market_size", "src-1", {
      value: { value: 100000000, unit: "USD" },
    });
    const fact2 = createMockFact("fact-2", "market_size", "src-2", {
      value: { value: 150000000, unit: "USD" }, // 50% difference
    });

    const report = detectConflicts([fact1, fact2], [source1, source2]);

    assert.ok(report.ok);
    assert.strictEqual(report.conflicts.length, 1);
    assert.strictEqual(report.conflicts[0].conflict_type, "numeric_disagreement");
    assert.strictEqual(report.conflicts[0].severity, "high"); // 50% is high
  });

  it("should not flag small numeric differences as conflicts", () => {
    const source1 = createMockSource("src-1");
    const source2 = createMockSource("src-2");

    const fact1 = createMockFact("fact-1", "market_size", "src-1", {
      value: { value: 100000000, unit: "USD" },
    });
    const fact2 = createMockFact("fact-2", "market_size", "src-2", {
      value: { value: 102000000, unit: "USD" }, // 2% difference
    });

    const report = detectConflicts([fact1, fact2], [source1, source2]);

    assert.strictEqual(report.conflicts.length, 0); // Within 10% threshold
  });

  it("should detect directional disagreement", () => {
    const source1 = createMockSource("src-1");
    const source2 = createMockSource("src-2");

    const fact1 = createMockFact("fact-1", "growth_trend", "src-1", {
      value: { text: "Industry is growing rapidly" },
    });
    const fact2 = createMockFact("fact-2", "growth_trend", "src-2", {
      value: { text: "Industry is declining significantly" },
    });

    const report = detectConflicts([fact1, fact2], [source1, source2]);

    assert.ok(report.conflicts.length >= 1);
    const directionalConflict = report.conflicts.find(
      (c) => c.conflict_type === "directional_disagreement"
    );
    assert.ok(directionalConflict);
    assert.strictEqual(directionalConflict!.severity, "high");
  });

  it("should generate explanation for conflicts", () => {
    const source1 = createMockSource("src-1", { source_name: "Source A" });
    const source2 = createMockSource("src-2", { source_name: "Source B" });

    const fact1 = createMockFact("fact-1", "market_size", "src-1", {
      value: { value: 100 },
    });
    const fact2 = createMockFact("fact-2", "market_size", "src-2", {
      value: { value: 150 },
    });

    const conflict = detectFactConflict(
      fact1,
      fact2,
      new Map([
        ["src-1", source1],
        ["src-2", source2],
      ])
    );

    assert.ok(conflict);
    assert.ok(conflict!.explanation.includes("Source A"));
    assert.ok(conflict!.explanation.includes("Source B"));
  });

  it("should recommend preferring higher trust source", () => {
    const source1 = createMockSource("src-1", {
      source_url: "https://api.census.gov/data/test", // High trust
      source_name: "Census",
    });
    const source2 = createMockSource("src-2", {
      source_url: "https://unknown-source.com/data", // Low trust
      source_name: "Unknown",
    });

    const fact1 = createMockFact("fact-1", "market_size", "src-1", {
      value: { value: 100 },
    });
    const fact2 = createMockFact("fact-2", "market_size", "src-2", {
      value: { value: 200 },
    });

    const conflict = detectFactConflict(
      fact1,
      fact2,
      new Map([
        ["src-1", source1],
        ["src-2", source2],
      ])
    );

    assert.ok(conflict);
    assert.strictEqual(conflict!.recommendation, "prefer_higher_trust");
  });

  it("should merge related conflicts", () => {
    const source1 = createMockSource("src-1");
    const source2 = createMockSource("src-2");
    const source3 = createMockSource("src-3");

    const fact1 = createMockFact("fact-1", "market_size", "src-1", {
      value: { value: 100 },
    });
    const fact2 = createMockFact("fact-2", "market_size", "src-2", {
      value: { value: 200 },
    });
    const fact3 = createMockFact("fact-3", "market_size", "src-3", {
      value: { value: 300 },
    });

    const report = detectConflicts(
      [fact1, fact2, fact3],
      [source1, source2, source3]
    );

    const merged = mergeConflicts(report.conflicts);

    // Should merge into fewer conflicts
    assert.ok(merged.length <= report.conflicts.length);
  });

  it("should get preferred fact based on recommendation", () => {
    const source1 = createMockSource("src-1", {
      source_url: "https://api.census.gov/data/test",
    });
    const source2 = createMockSource("src-2", {
      source_url: "https://unknown.com/data",
    });

    const fact1 = createMockFact("fact-1", "market_size", "src-1", {
      value: { value: 100 },
    });
    const fact2 = createMockFact("fact-2", "market_size", "src-2", {
      value: { value: 200 },
    });

    const conflict = detectFactConflict(
      fact1,
      fact2,
      new Map([
        ["src-1", source1],
        ["src-2", source2],
      ])
    );

    assert.ok(conflict);
    const preferred = getPreferredFact(conflict!);
    assert.ok(preferred);
    assert.strictEqual(preferred!.fact_id, "fact-1"); // Census has higher trust
  });

  it("should calculate conflict summary correctly", () => {
    const source1 = createMockSource("src-1");
    const source2 = createMockSource("src-2");

    const fact1 = createMockFact("fact-1", "market_size", "src-1", {
      value: { value: 100 },
    });
    const fact2 = createMockFact("fact-2", "market_size", "src-2", {
      value: { value: 200 },
    });
    const fact3 = createMockFact("fact-3", "growth_trend", "src-1", {
      value: { text: "growing" },
    });
    const fact4 = createMockFact("fact-4", "growth_trend", "src-2", {
      value: { text: "declining" },
    });

    const report = detectConflicts(
      [fact1, fact2, fact3, fact4],
      [source1, source2]
    );

    assert.ok(report.summary.total_conflicts >= 2);
    assert.ok(report.summary.by_fact_type["market_size"] >= 1);
  });
});
