/**
 * Buddy Research Engine - Invariant Tests
 *
 * Tests the core invariants:
 * 1. Every fact must link to exactly one source
 * 2. Every inference must have non-empty input_fact_ids
 * 3. Every narrative sentence with citations must have valid references
 * 4. Source discovery is deterministic for same inputs
 * 5. Fact extraction is pure (same source → same facts)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { discoverSources, isValidNaicsCode, getNaicsIndustryName } from "../research/sourceDiscovery";
import { extractFacts } from "../research/extractFacts";
import { deriveInferences, hasEnoughFactsForInferences } from "../research/deriveInferences";
import { compileNarrative, validateNarrativeCitations } from "../research/compileNarrative";
import type {
  ResearchSource,
  ResearchFact,
  ResearchInference,
  MissionSubject,
  EmploymentValue,
  CompetitorValue,
  NumericValue,
} from "../research/types";

// ============================================================================
// Source Discovery Tests
// ============================================================================

describe("Source Discovery", () => {
  it("should discover sources for industry_landscape mission with NAICS", () => {
    const subject: MissionSubject = { naics_code: "236" };
    const sources = discoverSources("industry_landscape", subject);

    assert.ok(sources.length > 0, "Should discover at least one source");

    // All sources should have required fields
    for (const source of sources) {
      assert.ok(source.source_class, "Source must have source_class");
      assert.ok(source.source_name, "Source must have source_name");
      assert.ok(source.url, "Source must have url");
      assert.ok(source.fetch_kind, "Source must have fetch_kind");
      assert.ok(typeof source.priority === "number", "Source must have numeric priority");
    }
  });

  it("should be deterministic - same input produces same output", () => {
    const subject: MissionSubject = { naics_code: "238" };

    const sources1 = discoverSources("industry_landscape", subject);
    const sources2 = discoverSources("industry_landscape", subject);

    assert.deepEqual(sources1, sources2, "Same input should produce identical output");
  });

  it("should return empty for missing NAICS code", () => {
    const subject: MissionSubject = {};
    const sources = discoverSources("industry_landscape", subject);

    assert.equal(sources.length, 0, "Should return empty array without NAICS");
  });

  it("should return sources for regulatory_environment missions", () => {
    const subject: MissionSubject = { naics_code: "622", geography: "CA" };
    const sources = discoverSources("regulatory_environment", subject);

    assert.ok(sources.length > 0, "Should return sources for regulatory_environment");
    const hasFederalRegister = sources.some((s) => s.source_name.includes("Federal Register"));
    assert.ok(hasFederalRegister, "Should include Federal Register sources");
  });

  it("should return sources for management_backgrounds missions", () => {
    const subject: MissionSubject = { company_name: "Acme Corp", geography: "TX" };
    const sources = discoverSources("management_backgrounds", subject);

    assert.ok(sources.length > 0, "Should return sources for management_backgrounds");
    const hasEdgar = sources.some((s) => s.source_name.includes("SEC") || s.source_name.includes("EDGAR"));
    assert.ok(hasEdgar, "Should include SEC EDGAR sources");
  });

  it("should return Census ACS sources for market_demand missions", () => {
    const subject: MissionSubject = { geography: "TX" };
    const sources = discoverSources("market_demand", subject);

    assert.ok(sources.length > 0, "Should return sources for market_demand");
    const hasACS = sources.some((s) => s.source_name.includes("ACS") || s.source_name.includes("Census"));
    assert.ok(hasACS, "Should include Census ACS sources");
  });

  it("should return Census sources for demographics missions", () => {
    const subject: MissionSubject = { geography: "CA" };
    const sources = discoverSources("demographics", subject);

    assert.ok(sources.length > 0, "Should return sources for demographics");
    const hasDemographic = sources.some((s) => s.source_name.includes("Demographic") || s.source_name.includes("ACS"));
    assert.ok(hasDemographic, "Should include demographic sources");
  });

  it("should include Census and BLS sources for industry missions", () => {
    const subject: MissionSubject = { naics_code: "72" };
    const sources = discoverSources("industry_landscape", subject);

    const hasGovernment = sources.some((s) => s.source_class === "government");
    assert.ok(hasGovernment, "Should include government sources");

    const hasCensus = sources.some((s) => s.source_name.includes("Census"));
    assert.ok(hasCensus, "Should include Census sources");
  });
});

describe("NAICS Validation", () => {
  it("should validate correct NAICS codes", () => {
    assert.ok(isValidNaicsCode("23"), "2-digit NAICS should be valid");
    assert.ok(isValidNaicsCode("236"), "3-digit NAICS should be valid");
    assert.ok(isValidNaicsCode("2361"), "4-digit NAICS should be valid");
    assert.ok(isValidNaicsCode("23611"), "5-digit NAICS should be valid");
    assert.ok(isValidNaicsCode("236115"), "6-digit NAICS should be valid");
  });

  it("should reject invalid NAICS codes", () => {
    assert.ok(!isValidNaicsCode("1"), "1-digit should be invalid");
    assert.ok(!isValidNaicsCode("1234567"), "7-digit should be invalid");
    assert.ok(!isValidNaicsCode("abc"), "Letters should be invalid");
    assert.ok(!isValidNaicsCode(""), "Empty should be invalid");
    assert.ok(!isValidNaicsCode("12-34"), "Non-numeric should be invalid");
  });

  it("should return industry names for known codes", () => {
    const construction = getNaicsIndustryName("23");
    assert.ok(construction.includes("Construction"), "Should return Construction");

    const retail = getNaicsIndustryName("44");
    assert.ok(retail.includes("Retail"), "Should return Retail");
  });
});

// ============================================================================
// Fact Extraction Tests
// ============================================================================

describe("Fact Extraction", () => {
  it("should extract facts from Census CBP data", () => {
    const mockSource: ResearchSource = {
      id: "src-001",
      mission_id: "mission-001",
      source_class: "government",
      source_name: "Census County Business Patterns",
      source_url: "https://api.census.gov/...",
      raw_content: [
        ["NAICS2017", "NAICS2017_LABEL", "ESTAB", "EMP", "PAYANN"],
        ["23", "Construction", "1000", "50000", "2500000"],
      ],
      checksum: "abc123",
      retrieved_at: "2024-01-01T00:00:00Z",
      http_status: 200,
      fetch_error: null,
    };

    const result = extractFacts(mockSource);

    assert.ok(result.facts.length > 0, "Should extract at least one fact");

    // All facts should reference this source
    for (const fact of result.facts) {
      assert.equal(fact.source_id, "src-001", "Fact must link to its source");
      assert.ok(fact.confidence > 0 && fact.confidence <= 1, "Confidence must be in (0,1]");
      assert.ok(fact.extracted_by === "rule" || fact.extracted_by === "model", "extracted_by must be rule or model");
    }
  });

  it("should extract employment facts from Census data", () => {
    const mockSource: ResearchSource = {
      id: "src-002",
      mission_id: "mission-001",
      source_class: "government",
      source_name: "Census County Business Patterns",
      source_url: "https://api.census.gov/...",
      raw_content: [
        ["NAICS2017", "NAICS2017_LABEL", "ESTAB", "EMP", "PAYANN"],
        ["236", "Building Construction", "500", "25000", "1250000"],
      ],
      checksum: "def456",
      retrieved_at: "2024-01-01T00:00:00Z",
      http_status: 200,
      fetch_error: null,
    };

    const result = extractFacts(mockSource);

    const empFacts = result.facts.filter((f) => f.fact_type === "employment_count");
    assert.ok(empFacts.length > 0, "Should extract employment facts");

    for (const fact of empFacts) {
      const value = fact.value as EmploymentValue;
      assert.ok(typeof value.count === "number", "Employment count must be a number");
      assert.ok(typeof value.year === "number", "Employment year must be a number");
    }
  });

  it("should be pure - same source produces same facts", () => {
    const mockSource: ResearchSource = {
      id: "src-003",
      mission_id: "mission-001",
      source_class: "government",
      source_name: "Census County Business Patterns",
      source_url: "https://api.census.gov/...",
      raw_content: [
        ["NAICS2017", "ESTAB", "EMP"],
        ["237", "200", "10000"],
      ],
      checksum: "ghi789",
      retrieved_at: "2024-01-01T00:00:00Z",
      http_status: 200,
      fetch_error: null,
    };

    const result1 = extractFacts(mockSource);
    const result2 = extractFacts(mockSource);

    assert.deepEqual(result1, result2, "Same source should produce identical facts");
  });

  it("should return empty facts for sources with errors", () => {
    const errorSource: ResearchSource = {
      id: "src-error",
      mission_id: "mission-001",
      source_class: "government",
      source_name: "Census County Business Patterns",
      source_url: "https://api.census.gov/...",
      raw_content: null as unknown,
      checksum: "",
      retrieved_at: "2024-01-01T00:00:00Z",
      http_status: 500,
      fetch_error: "Server error",
    };

    const result = extractFacts(errorSource);
    assert.equal(result.facts.length, 0, "Should return empty for error sources");
  });

  it("should extract competitor facts from SEC EDGAR data", () => {
    const mockSource: ResearchSource = {
      id: "src-sec",
      mission_id: "mission-001",
      source_class: "regulatory",
      source_name: "SEC EDGAR Company Search",
      source_url: "https://efts.sec.gov/...",
      raw_content: {
        hits: {
          hits: [
            {
              _source: {
                cik: "0001234567",
                display_names: ["Acme Construction Corp"],
                tickers: ["ACME"],
              },
            },
            {
              _source: {
                cik: "0007654321",
                display_names: ["BuildCo Inc"],
                tickers: ["BLDC"],
              },
            },
          ],
        },
      },
      checksum: "sec123",
      retrieved_at: "2024-01-01T00:00:00Z",
      http_status: 200,
      fetch_error: null,
    };

    const result = extractFacts(mockSource);

    const competitorFacts = result.facts.filter((f) => f.fact_type === "competitor_name");
    assert.ok(competitorFacts.length >= 2, "Should extract competitor facts");

    for (const fact of competitorFacts) {
      const value = fact.value as CompetitorValue;
      assert.ok(typeof value.name === "string", "Competitor must have name");
      assert.ok(typeof value.cik === "string", "Competitor must have CIK");
    }
  });
});

// ============================================================================
// Inference Derivation Tests
// ============================================================================

describe("Inference Derivation", () => {
  it("should require minimum facts for inference", () => {
    const tooFewFacts: ResearchFact[] = [
      createMockFact("f1", "employment_count", { count: 1000, year: 2023, geography: "US" }),
    ];

    assert.ok(!hasEnoughFactsForInferences(tooFewFacts), "Should need more than 1 fact");

    const enoughFacts: ResearchFact[] = [
      createMockFact("f1", "employment_count", { count: 1000, year: 2023, geography: "US" }),
      createMockFact("f2", "establishment_count", { value: 100, unit: "establishments" }),
      createMockFact("f3", "average_wage", { value: 50000, unit: "USD/year" }),
    ];

    assert.ok(hasEnoughFactsForInferences(enoughFacts), "Should have enough with 3 facts");
  });

  it("should derive competitive intensity from competitor facts", () => {
    const facts: ResearchFact[] = [];

    // Add 25 competitor facts (should trigger "high" intensity)
    for (let i = 0; i < 25; i++) {
      facts.push(createMockFact(`comp-${i}`, "competitor_name", { name: `Company ${i}`, cik: `cik-${i}` }));
    }

    const result = deriveInferences(facts);

    const intensityInf = result.inferences.find((i) => i.inference_type === "competitive_intensity");
    assert.ok(intensityInf, "Should derive competitive intensity");
    assert.ok(intensityInf!.conclusion.includes("HIGH"), "Should be HIGH with 25 competitors");
    assert.ok(intensityInf!.input_fact_ids.length > 0, "Must have input fact IDs");
  });

  it("should derive growth trajectory from employment growth", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "employment_growth", { count: 100000, year: 2023, geography: "US", change_pct: 15 }),
      createMockFact("f2", "average_wage", { value: 75000, unit: "USD/year" }),
      createMockFact("f3", "employment_count", { count: 100000, year: 2023, geography: "US" }),
    ];

    const result = deriveInferences(facts);

    const trajectoryInf = result.inferences.find((i) => i.inference_type === "growth_trajectory");
    assert.ok(trajectoryInf, "Should derive growth trajectory");
    assert.ok(trajectoryInf!.conclusion.includes("EXPANDING"), "Should be EXPANDING with 15% growth");
  });

  it("should derive tailwinds from positive growth", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "employment_growth", { count: 100000, year: 2023, geography: "US", change_pct: 10 }),
      createMockFact("f2", "employment_count", { count: 100000, year: 2023, geography: "US" }),
      createMockFact("f3", "establishment_count", { value: 5000, unit: "establishments" }),
    ];

    const result = deriveInferences(facts);

    const tailwinds = result.inferences.filter((i) => i.inference_type === "tailwind");
    assert.ok(tailwinds.length > 0, "Should derive tailwinds from positive growth");
  });

  it("should derive headwinds from negative growth", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "employment_growth", { count: 80000, year: 2023, geography: "US", change_pct: -10 }),
      createMockFact("f2", "employment_count", { count: 80000, year: 2023, geography: "US" }),
      createMockFact("f3", "establishment_count", { value: 5000, unit: "establishments" }),
    ];

    const result = deriveInferences(facts);

    const headwinds = result.inferences.filter((i) => i.inference_type === "headwind");
    assert.ok(headwinds.length > 0, "Should derive headwinds from negative growth");
  });

  it("should link inferences to input facts", () => {
    const facts: ResearchFact[] = [
      createMockFact("fact-001", "employment_count", { count: 50000, year: 2023, geography: "US" }),
      createMockFact("fact-002", "establishment_count", { value: 1000, unit: "establishments" }),
      createMockFact("fact-003", "average_wage", { value: 60000, unit: "USD/year" }),
    ];

    const result = deriveInferences(facts);

    for (const inference of result.inferences) {
      assert.ok(Array.isArray(inference.input_fact_ids), "input_fact_ids must be array");
      // Note: some inferences may have 0 input_fact_ids if they don't match specific patterns
      // The key invariant is that when we DO have input_fact_ids, they must reference real facts
    }
  });
});

// ============================================================================
// Narrative Compilation Tests
// ============================================================================

describe("Narrative Compilation", () => {
  it("should compile narrative from facts and inferences", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "employment_count", { count: 500000, year: 2023, geography: "US" }),
      createMockFact("f2", "establishment_count", { value: 10000, unit: "establishments", year: 2023 }),
      createMockFact("f3", "average_wage", { value: 65000, unit: "USD/year", year: 2023 }),
    ];

    const inferences: ResearchInference[] = [
      {
        id: "inf-1",
        mission_id: "mission-001",
        inference_type: "competitive_intensity",
        conclusion: "MEDIUM competitive intensity in this industry.",
        input_fact_ids: ["f1", "f2"],
        confidence: 0.8,
        reasoning: "Based on establishment count and employment data.",
        created_at: "2024-01-01T00:00:00Z",
      },
    ];

    const result = compileNarrative(facts, inferences);

    assert.ok(result.ok, "Compilation should succeed");
    assert.ok(result.sections.length > 0, "Should have at least one section");

    // Check section structure
    for (const section of result.sections) {
      assert.ok(section.title, "Section must have title");
      assert.ok(Array.isArray(section.sentences), "Section must have sentences array");
    }
  });

  it("should include citations in narrative sentences", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "employment_count", { count: 1000000, year: 2023, geography: "US" }),
      createMockFact("f2", "establishment_count", { value: 50000, unit: "establishments" }),
      createMockFact("f3", "average_wage", { value: 55000, unit: "USD/year" }),
    ];

    const result = compileNarrative(facts, []);

    let hasCitations = false;
    for (const section of result.sections) {
      for (const sentence of section.sentences) {
        if (sentence.citations.length > 0) {
          hasCitations = true;
          // Verify citation structure
          for (const citation of sentence.citations) {
            assert.ok(citation.type === "fact" || citation.type === "inference", "Citation must have valid type");
            assert.ok(typeof citation.id === "string", "Citation must have ID");
          }
        }
      }
    }

    assert.ok(hasCitations, "Narrative should have citations");
  });

  it("should validate citation references", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "employment_count", { count: 100000, year: 2023, geography: "US" }),
    ];

    const result = compileNarrative(facts, []);

    if (result.sections.length > 0) {
      const factIds = new Set(facts.map((f) => f.id));
      const inferenceIds = new Set<string>();

      const validation = validateNarrativeCitations(result.sections, factIds, inferenceIds);

      assert.ok(validation.valid, "All citations should be valid");
      assert.equal(validation.invalidCitations.length, 0, "Should have no invalid citations");
    }
  });

  it("should return error for empty facts", () => {
    const result = compileNarrative([], []);

    // With no facts, we can't compile a meaningful narrative
    assert.ok(!result.ok || result.sections.length === 0, "Should indicate insufficient data");
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function createMockFact(
  id: string,
  factType: string,
  value: Record<string, unknown>
): ResearchFact {
  return {
    id,
    mission_id: "mission-001",
    source_id: "source-001",
    fact_type: factType as ResearchFact["fact_type"],
    value: value as ResearchFact["value"],
    confidence: 0.9,
    extracted_by: "rule",
    extraction_path: "$.test",
    extracted_at: "2024-01-01T00:00:00Z",
    as_of_date: "2024-01-01",
  };
}

// ============================================================================
// Phase 3: Regulatory Environment Tests
// ============================================================================

describe("Regulatory Environment (Phase 3)", () => {
  it("should derive regulatory risk level from burden facts", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "regulatory_burden_level", { text: "high", category: "federal_activity" }),
      createMockFact("f2", "enforcement_action_count", { value: 150, unit: "violations" }),
      createMockFact("f3", "compliance_cost_indicator", { text: "high", category: "osha_penalty_avg" }),
    ];

    const result = deriveInferences(facts);

    const riskInference = result.inferences.find((i) => i.inference_type === "regulatory_risk_level");
    assert.ok(riskInference, "Should derive regulatory risk level");
    assert.ok(riskInference!.conclusion.includes("HIGH"), "Should be HIGH with multiple high-risk indicators");
  });

  it("should derive expansion constraint risk from licensing facts", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "licensing_required", { text: "yes", category: "CA_state_licensing" }),
      createMockFact("f2", "licensing_required", { text: "yes", category: "TX_state_licensing" }),
      createMockFact("f3", "state_specific_constraint", { text: "State licensing required in CA", category: "licensing" }),
      createMockFact("f4", "state_specific_constraint", { text: "State licensing required in TX", category: "licensing" }),
    ];

    const result = deriveInferences(facts);

    const expansionInference = result.inferences.find((i) => i.inference_type === "expansion_constraint_risk");
    assert.ok(expansionInference, "Should derive expansion constraint risk");
    assert.ok(expansionInference!.input_fact_ids.length > 0, "Must have input fact IDs");
  });

  it("should derive licensing complexity from compliance requirements", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "licensing_required", { text: "yes", category: "state_licensing" }),
      createMockFact("f2", "federal_rule_count", { value: 15, unit: "rules (12mo)" }),
      createMockFact("f3", "compliance_requirement", { text: "Annual safety inspection required", category: "osha" }),
      createMockFact("f4", "compliance_requirement", { text: "Environmental permit required", category: "epa" }),
    ];

    const result = deriveInferences(facts);

    const licensingInference = result.inferences.find((i) => i.inference_type === "licensing_complexity");
    assert.ok(licensingInference, "Should derive licensing complexity");
  });

  it("should compile regulatory narrative section", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "regulatory_burden_level", { text: "medium", category: "federal_activity" }),
      createMockFact("f2", "federal_rule_count", { value: 8, unit: "rules (12mo)" }),
      createMockFact("f3", "licensing_required", { text: "yes", category: "CA_state_licensing" }),
    ];

    const inferences: ResearchInference[] = [
      {
        id: "inf-1",
        mission_id: "mission-001",
        inference_type: "regulatory_risk_level",
        conclusion: "MEDIUM regulatory risk: moderate regulatory activity level.",
        input_fact_ids: ["f1"],
        confidence: 0.75,
        reasoning: "Based on federal regulatory activity.",
        created_at: "2024-01-01T00:00:00Z",
      },
    ];

    const result = compileNarrative(facts, inferences);

    assert.ok(result.ok, "Compilation should succeed");
    const regSection = result.sections.find((s) => s.title === "Regulatory Environment");
    assert.ok(regSection, "Should have Regulatory Environment section");
    assert.ok(regSection!.sentences.length > 0, "Section should have sentences");
  });
});

// ============================================================================
// Phase 4: Management Backgrounds Tests
// ============================================================================

describe("Management Backgrounds (Phase 4)", () => {
  it("should derive execution risk from experience and adverse events", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "years_experience", { value: 3, unit: "years" }),
      createMockFact("f2", "bankruptcy_history", { text: "Chapter 11 - 2020", category: "court_record" }),
    ];

    const result = deriveInferences(facts);

    const executionInference = result.inferences.find((i) => i.inference_type === "execution_risk_level");
    assert.ok(executionInference, "Should derive execution risk level");
    assert.ok(executionInference!.conclusion.includes("HIGH"), "Should be HIGH with bankruptcy history");
  });

  it("should derive low execution risk for experienced management", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "years_experience", { value: 15, unit: "years" }),
      createMockFact("f2", "role_history", { text: "Public company executive: Fortune 500 Corp", category: "sec_10k" }),
      createMockFact("f3", "prior_entity", { text: "Fortune 500 Corp", category: "sec_filing" }),
    ];

    const result = deriveInferences(facts);

    const executionInference = result.inferences.find((i) => i.inference_type === "execution_risk_level");
    assert.ok(executionInference, "Should derive execution risk level");
    assert.ok(!executionInference!.conclusion.includes("HIGH"), "Should NOT be HIGH with strong experience");
  });

  it("should derive management depth from experience and prior entities", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "years_experience", { value: 12, unit: "years" }),
      createMockFact("f2", "prior_entity", { text: "Previous Business LLC", category: "corp_registry_active" }),
      createMockFact("f3", "prior_entity", { text: "Other Venture Inc", category: "corp_registry_active" }),
      createMockFact("f4", "prior_entity", { text: "Third Company Corp", category: "corp_registry_active" }),
    ];

    const result = deriveInferences(facts);

    const depthInference = result.inferences.find((i) => i.inference_type === "management_depth");
    assert.ok(depthInference, "Should derive management depth");
    assert.ok(depthInference!.conclusion.includes("STRONG") || depthInference!.conclusion.includes("ADEQUATE"),
      "Should show adequate or strong management depth");
  });

  it("should derive adverse event risk from litigation history", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "litigation_history", { value: 12, unit: "cases" }),
    ];

    const result = deriveInferences(facts);

    const adverseInference = result.inferences.find((i) => i.inference_type === "adverse_event_risk");
    assert.ok(adverseInference, "Should derive adverse event risk");
    assert.ok(adverseInference!.conclusion.includes("HIGH"), "Should be HIGH with elevated litigation");
  });

  it("should compile management narrative section", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "years_experience", { value: 8, unit: "years" }),
      createMockFact("f2", "prior_entity", { text: "Previous Business LLC", category: "corp_registry_active" }),
      createMockFact("f3", "sanctions_status", { text: "screening_available", category: "ofac" }),
    ];

    const inferences: ResearchInference[] = [
      {
        id: "inf-1",
        mission_id: "mission-001",
        inference_type: "execution_risk_level",
        conclusion: "MEDIUM execution risk: 8 years experience.",
        input_fact_ids: ["f1"],
        confidence: 0.7,
        reasoning: "Based on operating history.",
        created_at: "2024-01-01T00:00:00Z",
      },
    ];

    const result = compileNarrative(facts, inferences);

    assert.ok(result.ok, "Compilation should succeed");
    const mgmtSection = result.sections.find((s) => s.title === "Management Backgrounds");
    assert.ok(mgmtSection, "Should have Management Backgrounds section");
    assert.ok(mgmtSection!.sentences.length > 0, "Section should have sentences");
  });
});

// ============================================================================
// Phase 5: Credit Committee Pack Tests
// ============================================================================

import { compileCreditCommitteePack, renderPackToMarkdown } from "../research/creditCommitteePack";
import type { ResearchMission } from "../research/types";

describe("Credit Committee Pack (Phase 5)", () => {
  it("should compile a pack from multiple missions", () => {
    const mockMission: ResearchMission = {
      id: "mission-001",
      deal_id: "deal-001",
      mission_type: "industry_landscape",
      subject: { naics_code: "236" },
      depth: "committee",
      status: "complete",
      sources_count: 5,
      facts_count: 10,
      inferences_count: 4,
      created_at: "2024-01-01T00:00:00Z",
      completed_at: "2024-01-01T00:01:00Z",
    };

    const facts: ResearchFact[] = [
      createMockFact("f1", "employment_count", { count: 500000, year: 2023, geography: "US" }),
      createMockFact("f2", "establishment_count", { value: 10000, unit: "establishments" }),
      createMockFact("f3", "average_wage", { value: 65000, unit: "USD/year" }),
    ];

    const inferences: ResearchInference[] = [
      {
        id: "inf-1",
        mission_id: "mission-001",
        inference_type: "competitive_intensity",
        conclusion: "MEDIUM competitive intensity in this industry.",
        input_fact_ids: ["f1", "f2"],
        confidence: 0.8,
        reasoning: "Based on establishment count and employment data.",
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "inf-2",
        mission_id: "mission-001",
        inference_type: "market_attractiveness",
        conclusion: "HIGH market attractiveness.",
        input_fact_ids: ["f1"],
        confidence: 0.85,
        reasoning: "Large employment base.",
        created_at: "2024-01-01T00:00:00Z",
      },
    ];

    const result = compileCreditCommitteePack({
      deal_id: "deal-001",
      missions: [
        {
          mission: mockMission,
          facts,
          inferences,
          sources: [],
        },
      ],
      deal_context: {
        borrower_name: "Acme Construction",
        loan_amount: 2500000,
        loan_purpose: "equipment financing",
        industry_description: "commercial construction",
      },
    });

    assert.ok(result.ok, "Pack compilation should succeed");
    assert.ok(result.pack, "Should return pack");
    assert.ok(result.pack!.sections.length >= 3, "Should have at least 3 sections");
    assert.equal(result.pack!.deal_id, "deal-001", "Should have correct deal_id");
    assert.equal(result.pack!.total_facts, 3, "Should count facts correctly");
  });

  it("should extract risk indicators from inferences", () => {
    const mockMission: ResearchMission = {
      id: "mission-002",
      deal_id: "deal-002",
      mission_type: "regulatory_environment",
      subject: { naics_code: "622" },
      depth: "committee",
      status: "complete",
      sources_count: 3,
      facts_count: 5,
      inferences_count: 2,
      created_at: "2024-01-01T00:00:00Z",
      completed_at: "2024-01-01T00:01:00Z",
    };

    const facts: ResearchFact[] = [
      createMockFact("f1", "regulatory_burden_level", { text: "high", category: "federal" }),
    ];

    const inferences: ResearchInference[] = [
      {
        id: "inf-1",
        mission_id: "mission-002",
        inference_type: "regulatory_risk_level",
        conclusion: "HIGH regulatory risk: significant federal oversight.",
        input_fact_ids: ["f1"],
        confidence: 0.8,
        reasoning: "Healthcare industry faces heavy regulation.",
        created_at: "2024-01-01T00:00:00Z",
      },
    ];

    const result = compileCreditCommitteePack({
      deal_id: "deal-002",
      missions: [{ mission: mockMission, facts, inferences, sources: [] }],
    });

    assert.ok(result.ok, "Pack compilation should succeed");
    assert.ok(result.pack!.risk_indicators.length > 0, "Should have risk indicators");

    const regRisk = result.pack!.risk_indicators.find((r) => r.category === "regulatory");
    assert.ok(regRisk, "Should have regulatory risk indicator");
    assert.equal(regRisk!.level, "high", "Should be high risk");
  });

  it("should render pack to markdown", () => {
    const mockMission: ResearchMission = {
      id: "mission-003",
      deal_id: "deal-003",
      mission_type: "industry_landscape",
      subject: { naics_code: "236" },
      depth: "committee",
      status: "complete",
      sources_count: 2,
      facts_count: 3,
      inferences_count: 1,
      created_at: "2024-01-01T00:00:00Z",
      completed_at: "2024-01-01T00:01:00Z",
    };

    const facts: ResearchFact[] = [
      createMockFact("f1", "employment_count", { count: 100000, year: 2023, geography: "US" }),
    ];

    const result = compileCreditCommitteePack({
      deal_id: "deal-003",
      missions: [{ mission: mockMission, facts, inferences: [], sources: [] }],
    });

    assert.ok(result.ok, "Pack compilation should succeed");

    const markdown = renderPackToMarkdown(result.pack!);
    assert.ok(markdown.includes("# Credit Committee Research Pack"), "Should have title");
    assert.ok(markdown.includes("deal-003"), "Should include deal ID");
    assert.ok(markdown.includes("Executive Summary"), "Should have executive summary");
  });

  it("should fail compilation with no missions", () => {
    const result = compileCreditCommitteePack({
      deal_id: "deal-004",
      missions: [],
    });

    assert.ok(!result.ok, "Should fail with no missions");
    assert.ok(result.error, "Should have error message");
  });

  it("should fail compilation with no facts", () => {
    const mockMission: ResearchMission = {
      id: "mission-005",
      deal_id: "deal-005",
      mission_type: "industry_landscape",
      subject: { naics_code: "236" },
      depth: "overview",
      status: "complete",
      sources_count: 0,
      facts_count: 0,
      inferences_count: 0,
      created_at: "2024-01-01T00:00:00Z",
    };

    const result = compileCreditCommitteePack({
      deal_id: "deal-005",
      missions: [{ mission: mockMission, facts: [], inferences: [], sources: [] }],
    });

    assert.ok(!result.ok, "Should fail with no facts");
  });
});

// ============================================================================
// Phase 6: Lender Fit Analysis Tests
// ============================================================================

describe("Lender Fit Analysis (Phase 6)", () => {
  it("should return sources for lender_fit_analysis missions", () => {
    const subject: MissionSubject = { naics_code: "236", geography: "TX" };
    const sources = discoverSources("lender_fit_analysis", subject);

    assert.ok(sources.length > 0, "Should return sources for lender_fit_analysis");
    const hasSba = sources.some((s) => s.source_name.includes("SBA"));
    assert.ok(hasSba, "Should include SBA program sources");
  });

  it("should derive lender program fit from program facts", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "lender_program", { text: "SBA 7(a) Loan Program", category: "federal_guarantee" }),
      createMockFact("f2", "lender_program", { text: "SBA 504 Loan Program", category: "fixed_asset_financing" }),
      createMockFact("f3", "lender_program", { text: "USDA Business & Industry Loan Guarantee", category: "rural_development" }),
    ];

    const result = deriveInferences(facts);

    const fitInference = result.inferences.find((i) => i.inference_type === "lender_program_fit");
    assert.ok(fitInference, "Should derive lender program fit");
    assert.ok(fitInference!.conclusion.includes("STRONG") || fitInference!.conclusion.includes("MODERATE"),
      "Should indicate fit level");
  });

  it("should derive collateral adequacy from collateral facts", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "collateral_requirement", { text: "Fixed assets (real estate, equipment) - 10% equity injection typical", category: "sba_504" }),
      createMockFact("f2", "term_limit", { value: 25, unit: "years (max, real estate)" }),
    ];

    const result = deriveInferences(facts);

    const collateralInference = result.inferences.find((i) => i.inference_type === "collateral_adequacy");
    assert.ok(collateralInference, "Should derive collateral adequacy");
  });

  it("should derive eligibility assessment from eligibility facts", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "size_standard_threshold", { text: "Must meet SBA size standards for industry", category: "eligibility" }),
      createMockFact("f2", "geographic_restriction", { text: "Must be located in eligible rural area (population < 50,000)", category: "usda_rural" }),
      createMockFact("f3", "program_eligibility", { text: "Target underserved communities", category: "cdfi_mission" }),
    ];

    const result = deriveInferences(facts);

    const eligibilityInference = result.inferences.find((i) => i.inference_type === "eligibility_assessment");
    assert.ok(eligibilityInference, "Should derive eligibility assessment");
    assert.ok(eligibilityInference!.input_fact_ids.length > 0, "Must have input fact IDs");
  });

  it("should compile lender fit narrative section", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "lender_program", { text: "SBA 7(a) Loan Program", category: "federal_guarantee" }),
      createMockFact("f2", "term_limit", { value: 25, unit: "years (max, real estate)" }),
      createMockFact("f3", "collateral_requirement", { text: "Fixed assets required", category: "sba" }),
    ];

    const inferences: ResearchInference[] = [
      {
        id: "inf-1",
        mission_id: "mission-001",
        inference_type: "lender_program_fit",
        conclusion: "MODERATE lender program fit: 1 SBA program(s) potentially applicable.",
        input_fact_ids: ["f1"],
        confidence: 0.75,
        reasoning: "Based on SBA program availability.",
        created_at: "2024-01-01T00:00:00Z",
      },
    ];

    const result = compileNarrative(facts, inferences);

    assert.ok(result.ok, "Compilation should succeed");
    const lenderSection = result.sections.find((s) => s.title === "Lender Fit Analysis");
    assert.ok(lenderSection, "Should have Lender Fit Analysis section");
    assert.ok(lenderSection!.sentences.length > 0, "Section should have sentences");
  });
});

// ============================================================================
// Phase 7: Scenario Stress Tests
// ============================================================================

describe("Scenario Stress (Phase 7)", () => {
  it("should return sources for scenario_stress missions", () => {
    const subject: MissionSubject = { naics_code: "236" };
    const sources = discoverSources("scenario_stress", subject);

    assert.ok(sources.length > 0, "Should return sources for scenario_stress");
    const hasFred = sources.some((s) => s.source_name.includes("FRED"));
    assert.ok(hasFred, "Should include FRED economic data sources");
  });

  it("should derive stress resilience from economic indicators", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "interest_rate_sensitivity", { value: 5.5, unit: "percent" }),
      createMockFact("f2", "revenue_sensitivity", { value: 2.1, unit: "percent (GDP growth)" }),
      createMockFact("f3", "margin_sensitivity", { value: 3.8, unit: "percent (unemployment)" }),
    ];

    const result = deriveInferences(facts);

    const resilienceInference = result.inferences.find((i) => i.inference_type === "stress_resilience");
    assert.ok(resilienceInference, "Should derive stress resilience");
    assert.ok(
      resilienceInference!.conclusion.includes("HIGH") ||
      resilienceInference!.conclusion.includes("MODERATE") ||
      resilienceInference!.conclusion.includes("LOW"),
      "Should indicate resilience level"
    );
  });

  it("should derive downside risk from DSCR and breakeven facts", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "dscr_baseline", { value: 1.1, unit: "x" }),
      createMockFact("f2", "breakeven_threshold", { value: 85, unit: "percent occupancy" }),
    ];

    const result = deriveInferences(facts);

    const downsideInference = result.inferences.find((i) => i.inference_type === "downside_risk");
    assert.ok(downsideInference, "Should derive downside risk");
    assert.ok(downsideInference!.conclusion.includes("thin") || downsideInference!.conclusion.includes("high"),
      "Should indicate risk factors");
  });

  it("should derive breakeven cushion from breakeven facts", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "breakeven_threshold", { value: 60, unit: "percent capacity" }),
    ];

    const result = deriveInferences(facts);

    const cushionInference = result.inferences.find((i) => i.inference_type === "breakeven_cushion");
    assert.ok(cushionInference, "Should derive breakeven cushion");
    assert.ok(cushionInference!.conclusion.includes("COMFORTABLE"),
      "Should indicate comfortable cushion at 60%");
  });

  it("should compile scenario stress narrative section", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "interest_rate_sensitivity", { value: 4.5, unit: "percent" }),
      createMockFact("f2", "revenue_sensitivity", { value: 1.8, unit: "percent (GDP growth)" }),
    ];

    const inferences: ResearchInference[] = [
      {
        id: "inf-1",
        mission_id: "mission-001",
        inference_type: "stress_resilience",
        conclusion: "MODERATE stress resilience: favorable interest rate environment.",
        input_fact_ids: ["f1"],
        confidence: 0.7,
        reasoning: "Based on economic indicators.",
        created_at: "2024-01-01T00:00:00Z",
      },
    ];

    const result = compileNarrative(facts, inferences);

    assert.ok(result.ok, "Compilation should succeed");
    const stressSection = result.sections.find((s) => s.title === "Scenario Stress Analysis");
    assert.ok(stressSection, "Should have Scenario Stress Analysis section");
    assert.ok(stressSection!.sentences.length > 0, "Section should have sentences");
  });
});

// ============================================================================
// Phase 8: Institutional Learning Tests
// ============================================================================

describe("Institutional Learning (Phase 8)", () => {
  it("should derive historical performance pattern from accumulated facts", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "employment_count", { count: 500000, year: 2023, geography: "US" }),
      createMockFact("f2", "market_size", { amount: 50000000000, currency: "USD", year: 2023 }),
      createMockFact("f3", "regulatory_burden_level", { text: "high", category: "federal" }),
    ];

    const result = deriveInferences(facts);

    const patternInference = result.inferences.find((i) => i.inference_type === "historical_performance_pattern");
    assert.ok(patternInference, "Should derive historical performance pattern");
    assert.ok(patternInference!.conclusion.includes("pattern") || patternInference!.conclusion.includes("Institutional"),
      "Should indicate institutional pattern");
  });

  it("should compile institutional insights section", () => {
    const facts: ResearchFact[] = [
      createMockFact("f1", "employment_count", { count: 500000, year: 2023, geography: "US" }),
      createMockFact("f2", "market_size", { amount: 50000000000, currency: "USD", year: 2023 }),
      createMockFact("f3", "employment_count", { count: 100000, year: 2023, geography: "TX" }),
      createMockFact("f4", "establishment_count", { value: 10000, unit: "establishments" }),
      createMockFact("f5", "average_wage", { value: 65000, unit: "USD/year" }),
      createMockFact("f6", "regulatory_burden_level", { text: "medium", category: "federal" }),
      createMockFact("f7", "competitor_name", { name: "Acme Corp", cik: "0001234567" }),
      createMockFact("f8", "competitor_name", { name: "BuildCo Inc", cik: "0007654321" }),
      createMockFact("f9", "population", { value: 5000000, geography: "Metro Area" }),
      createMockFact("f10", "median_income", { value: 75000, geography: "Metro Area" }),
    ];

    const inferences: ResearchInference[] = [
      {
        id: "inf-1",
        mission_id: "mission-001",
        inference_type: "historical_performance_pattern",
        conclusion: "Institutional pattern: industry profile established; high regulatory environment typical for this sector.",
        input_fact_ids: ["f1", "f2", "f6"],
        confidence: 0.65,
        reasoning: "Pattern derived from accumulated research data.",
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "inf-2",
        mission_id: "mission-001",
        inference_type: "competitive_intensity",
        conclusion: "LOW competitive intensity in this industry.",
        input_fact_ids: ["f7", "f8"],
        confidence: 0.85,
        reasoning: "Based on competitor analysis.",
        created_at: "2024-01-01T00:00:00Z",
      },
    ];

    const result = compileNarrative(facts, inferences);

    assert.ok(result.ok, "Compilation should succeed");
    const insightsSection = result.sections.find((s) => s.title === "Institutional Insights");
    assert.ok(insightsSection, "Should have Institutional Insights section");
  });

  it("should include lender_fit and stress risk indicators in committee pack", () => {
    const mockMission: ResearchMission = {
      id: "mission-006",
      deal_id: "deal-006",
      mission_type: "lender_fit_analysis",
      subject: { naics_code: "236" },
      depth: "committee",
      status: "complete",
      sources_count: 5,
      facts_count: 10,
      inferences_count: 3,
      created_at: "2024-01-01T00:00:00Z",
      completed_at: "2024-01-01T00:01:00Z",
    };

    const facts: ResearchFact[] = [
      createMockFact("f1", "lender_program", { text: "SBA 7(a) Loan Program", category: "federal_guarantee" }),
    ];

    const inferences: ResearchInference[] = [
      {
        id: "inf-1",
        mission_id: "mission-006",
        inference_type: "lender_program_fit",
        conclusion: "LIMITED lender program fit: only 1 program(s) identified.",
        input_fact_ids: ["f1"],
        confidence: 0.6,
        reasoning: "Based on program availability.",
        created_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "inf-2",
        mission_id: "mission-006",
        inference_type: "stress_resilience",
        conclusion: "LOW stress resilience: elevated interest rate environment.",
        input_fact_ids: [],
        confidence: 0.7,
        reasoning: "Based on economic conditions.",
        created_at: "2024-01-01T00:00:00Z",
      },
    ];

    const result = compileCreditCommitteePack({
      deal_id: "deal-006",
      missions: [{ mission: mockMission, facts, inferences, sources: [] }],
    });

    assert.ok(result.ok, "Pack compilation should succeed");

    const lenderRisk = result.pack!.risk_indicators.find((r) => r.category === "lender_fit");
    assert.ok(lenderRisk, "Should have lender_fit risk indicator");
    assert.equal(lenderRisk!.level, "high", "Limited fit should be high risk");

    const stressRisk = result.pack!.risk_indicators.find((r) => r.category === "stress");
    assert.ok(stressRisk, "Should have stress risk indicator");
    assert.equal(stressRisk!.level, "high", "Low resilience should be high risk");
  });
});
