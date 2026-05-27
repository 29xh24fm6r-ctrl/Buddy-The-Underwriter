import { describe, expect, it } from "vitest";
import { buildMarketDynamicsNarrative } from "../buildMarketDynamics";

describe("buildMarketDynamicsNarrative", () => {
  it("uses contact-center specific credit dynamics for NAICS 561422", () => {
    const text = buildMarketDynamicsNarrative({
      naicsCode: "561422",
      researchMarketDynamics: null,
    });

    expect(text).toContain("Contact-center and business process outsourcing");
    expect(text).toContain("enterprise payment terms");
    expect(text).toContain("accounts receivable-backed working-capital line");
    expect(text).toContain("eligible receivables");
  });

  it("replaces thin public-competitor-count research with credit-relevant NAICS narrative", () => {
    const text = buildMarketDynamicsNarrative({
      naicsCode: "561422",
      researchMarketDynamics:
        "LOW competitive intensity in this industry. Low competitive intensity: only 0 public competitors identified HIGH market attractiveness.",
    });

    expect(text).not.toContain("only 0 public competitors identified");
    expect(text).toContain("margin compression from competitive rebids");
  });

  it("preserves strong research but appends NAICS-specific underwriting implications", () => {
    const text = buildMarketDynamicsNarrative({
      naicsCode: "561422",
      researchMarketDynamics:
        "Enterprise outsourcing demand remains supported by customer support complexity, multi-channel service requirements, and the need for scalable operating partners with flexible staffing models across domestic and offshore delivery locations.",
    });

    expect(text).toContain("Enterprise outsourcing demand remains supported");
    expect(text).toContain("For an accounts receivable-backed working-capital line");
  });
});
