import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const OMEGA_DIR = path.resolve(__dirname, "..");

const GENERATOR_FILES = [
  "generateOmegaExplanation.ts",
  "generateOmegaRecommendations.ts",
  "generateOmegaRiskNarrative.ts",
  "generateOmegaCommunication.ts",
  "generateOmegaScenarios.ts",
  "omegaGeminiClient.ts",
];

const TYPE_FILES = [
  "relationshipAdvisoryTypes.ts",
];

const API_DIR = path.resolve(__dirname, "../../../app/api/omega");

function readFile(dir: string, name: string): string {
  return fs.readFileSync(path.join(dir, name), "utf-8");
}

// ─── D. Guardrails (no DB writes, no execution, no policy override) ───────────

describe("Omega guardrails — generators", () => {
  it("generators do not import supabaseAdmin", () => {
    for (const f of GENERATOR_FILES) {
      const content = readFile(OMEGA_DIR, f);
      // omegaGeminiClient is allowed to not have it; generators should not
      if (f === "omegaGeminiClient.ts") continue;
      assert.ok(
        !content.includes("supabaseAdmin"),
        `${f} must not import supabaseAdmin — Omega never writes canonical`,
      );
    }
  });

  it("generators do not call .insert() or .update() or .delete()", () => {
    for (const f of GENERATOR_FILES) {
      const content = readFile(OMEGA_DIR, f);
      assert.ok(!content.includes(".insert("), `${f} must not use .insert()`);
      assert.ok(!content.includes(".update("), `${f} must not use .update()`);
      assert.ok(!content.includes(".delete("), `${f} must not use .delete()`);
    }
  });

  it("generators do not import execution routes", () => {
    for (const f of GENERATOR_FILES) {
      const content = readFile(OMEGA_DIR, f);
      assert.ok(!content.includes("executeAction"), `${f} must not import execution`);
      assert.ok(!content.includes("canonicalActionExecution"), `${f} must not import execution map`);
    }
  });

  it("no Math.random in generators", () => {
    for (const f of GENERATOR_FILES) {
      const content = readFile(OMEGA_DIR, f);
      assert.ok(!content.includes("Math.random"), `${f} must not use Math.random`);
    }
  });
});

describe("Omega guardrails — types", () => {
  it("types file has zero runtime imports (only type imports)", () => {
    const content = readFile(OMEGA_DIR, "relationshipAdvisoryTypes.ts");
    const runtimeImports = content.split("\n").filter(
      (l) => l.startsWith("import ") && !l.includes("type"),
    );
    assert.equal(runtimeImports.length, 0, "Types file must have zero runtime imports");
  });

  it("all outputs include advisory meta marker", () => {
    const content = readFile(OMEGA_DIR, "relationshipAdvisoryTypes.ts");
    assert.ok(content.includes("advisory: true"), "Output types must include advisory: true marker");
  });
});

describe("Omega guardrails — API routes", () => {
  it("relationship route does not write to canonical tables", () => {
    const content = readFile(API_DIR, "relationship/route.ts");
    // Route reads surface snapshots but must not write to canonical tables
    // .update() on crypto hash is OK — check for supabase-pattern writes only
    assert.ok(!content.includes(".insert("), "Relationship route must not insert");
    assert.ok(!content.includes(".delete("), "Relationship route must not delete");
    // Check no supabase .update() calls (hash .update() is fine)
    const lines = content.split("\n");
    const supabaseUpdates = lines.filter(
      (l) => l.includes(".update(") && !l.includes("Hash") && !l.includes("hash") && !l.includes("createHash"),
    );
    assert.equal(supabaseUpdates.length, 0, "Relationship route must not have supabase .update() calls");
    // Supabase reads are OK (for loading context)
    assert.ok(content.includes("supabaseAdmin"), "Route loads context via supabaseAdmin (read-only)");
  });

  it("portfolio route does not write to canonical tables", () => {
    const content = readFile(API_DIR, "portfolio/route.ts");
    assert.ok(!content.includes(".insert("), "Portfolio route must not insert");
    assert.ok(!content.includes(".update("), "Portfolio route must not update");
    assert.ok(!content.includes(".delete("), "Portfolio route must not delete");
  });

  it("relationship route includes advisory meta in response", () => {
    const content = readFile(API_DIR, "relationship/route.ts");
    assert.ok(content.includes("advisory: true"), "Response must include advisory: true");
  });

  it("portfolio route includes advisory meta in response", () => {
    const content = readFile(API_DIR, "portfolio/route.ts");
    assert.ok(content.includes("advisory: true"), "Response must include advisory: true");
  });

  it("both routes require auth", () => {
    const relContent = readFile(API_DIR, "relationship/route.ts");
    const portContent = readFile(API_DIR, "portfolio/route.ts");
    assert.ok(relContent.includes("clerkAuth"), "Relationship route must use clerkAuth");
    assert.ok(portContent.includes("clerkAuth"), "Portfolio route must use clerkAuth");
  });
});

// ─── A. Input integrity ───────────────────────────────────────────────────────

describe("Omega input integrity", () => {
  it("OmegaRelationshipContext type requires relationship field", () => {
    const content = readFile(OMEGA_DIR, "relationshipAdvisoryTypes.ts");
    assert.ok(content.includes("relationship: RelationshipSurfaceItem"));
  });

  it("OmegaRelationshipContext type requires canonicalFacts", () => {
    const content = readFile(OMEGA_DIR, "relationshipAdvisoryTypes.ts");
    assert.ok(content.includes("canonicalFacts:"));
  });

  it("OmegaRelationshipContext type requires evidence", () => {
    const content = readFile(OMEGA_DIR, "relationshipAdvisoryTypes.ts");
    assert.ok(content.includes("evidence: RelationshipEvidenceEnvelope[]"));
  });

  it("OmegaRelationshipContext type requires timeline", () => {
    const content = readFile(OMEGA_DIR, "relationshipAdvisoryTypes.ts");
    assert.ok(content.includes("timeline: RelationshipSurfaceTimelineEntry[]"));
  });

  it("generator prompts forbid inventing facts", () => {
    for (const f of GENERATOR_FILES) {
      if (f === "omegaGeminiClient.ts") continue;
      const content = readFile(OMEGA_DIR, f);
      if (content.includes("prompt")) {
        assert.ok(
          content.includes("Do NOT invent") || content.includes("Do NOT speculate") || content.includes("Only use facts"),
          `${f} prompt must forbid hallucination`,
        );
      }
    }
  });

  it("generator prompts forbid contradicting canonical state", () => {
    const explanation = readFile(OMEGA_DIR, "generateOmegaExplanation.ts");
    assert.ok(explanation.includes("Do NOT contradict"));
    const recommendations = readFile(OMEGA_DIR, "generateOmegaRecommendations.ts");
    assert.ok(recommendations.includes("Do NOT suggest actions that contradict"));
  });
});

// ─── B. Output grounding ──────────────────────────────────────────────────────

describe("Omega output grounding", () => {
  it("explanation output includes keyDrivers", () => {
    const content = readFile(OMEGA_DIR, "relationshipAdvisoryTypes.ts");
    assert.ok(content.includes("keyDrivers: string[]"));
  });

  it("recommendation output maps to canonical actions", () => {
    const content = readFile(OMEGA_DIR, "relationshipAdvisoryTypes.ts");
    assert.ok(content.includes("relatedCanonicalAction"));
  });

  it("risk narrative constrained to facts", () => {
    const content = readFile(OMEGA_DIR, "generateOmegaRiskNarrative.ts");
    assert.ok(content.includes("ONLY on provided evidence"));
  });

  it("communication forbids internal jargon in borrower message", () => {
    const content = readFile(OMEGA_DIR, "generateOmegaCommunication.ts");
    assert.ok(content.includes("NEVER mention"));
    assert.ok(content.includes("watchlist"));
  });

  it("scenarios bounded to 3", () => {
    const content = readFile(OMEGA_DIR, "generateOmegaScenarios.ts");
    assert.ok(content.includes("slice(0, 3)"));
  });
});
