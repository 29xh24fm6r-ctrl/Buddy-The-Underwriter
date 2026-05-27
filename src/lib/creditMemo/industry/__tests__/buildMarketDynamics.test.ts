import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMarketDynamicsNarrative } from "../buildMarketDynamics";

describe("buildMarketDynamicsNarrative", () => {
  it("uses contact-center specific credit dynamics for NAICS 561422", () => {
    const text = buildMarketDynamicsNarrative({
      naicsCode: "561422",
      researchMarketDynamics: null,
    });

    assert.ok(text);
    assert.ok(text.includes("Contact-center and business process outsourcing"));
    assert.ok(text.includes("enterprise payment terms"));
    assert.ok(text.includes("accounts receivable-backed working-capital line"));
    assert.ok(text.includes("eligible receivables"));
  });

  it("replaces thin public-competitor-count research with credit-relevant NAICS narrative", () => {
    const text = buildMarketDynamicsNarrative({
      naicsCode: "561422",
      researchMarketDynamics:
        "LOW competitive intensity in this industry. Low competitive intensity: only 0 public competitors identified HIGH market attractiveness.",
    });

    assert.ok(text);
    assert.ok(!text.includes("only 0 public competitors identified"));
    assert.ok(text.includes("margin compression from competitive rebids"));
  });

  it("preserves strong research but appends NAICS-specific underwriting implications", () => {
    const text = buildMarketDynamicsNarrative({
      naicsCode: "561422",
      researchMarketDynamics:
        "Enterprise outsourcing demand remains supported by customer support complexity, multi-channel service requirements, and the need for scalable operating partners with flexible staffing models across domestic and offshore delivery locations.",
    });

    assert.ok(text);
    assert.ok(text.includes("Enterprise outsourcing demand remains supported"));
    assert.ok(text.includes("For an accounts receivable-backed working-capital line"));
  });
});
