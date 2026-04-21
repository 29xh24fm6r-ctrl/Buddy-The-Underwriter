import "server-only";

// src/lib/feasibility/locationSuitabilityAnalysis.ts
// Phase God Tier Feasibility — Location Suitability dimension (step 6/16).
// Pure function. Scores economic health, real estate, access & visibility,
// and risk exposure from BIE research + trade-area + property inputs.

import type {
  DimensionScore,
  LocationSuitabilityInput,
  LocationSuitabilityScore,
  MarketFlag,
} from "./types";

export function analyzeLocationSuitability(
  input: LocationSuitabilityInput,
): LocationSuitabilityScore {
  const flags: MarketFlag[] = [];

  // ── Economic Health ────────────────────────────────────────────────

  let econScore: DimensionScore;
  if (input.research.trendDirection) {
    let score = 50;
    switch (input.research.trendDirection) {
      case "improving":
        score = 85;
        break;
      case "stable":
        score = 65;
        break;
      case "deteriorating":
        score = 30;
        break;
      case "unclear":
        score = 50;
        break;
    }

    if (input.tradeArea?.unemploymentRate != null) {
      const ue = input.tradeArea.unemploymentRate;
      if (ue < 0.035) score = Math.min(100, score + 10);
      if (ue > 0.06) score = Math.max(0, score - 15);
      if (ue > 0.08) {
        flags.push({
          severity: "warning",
          dimension: "economicHealth",
          message: `Local unemployment rate of ${(ue * 100).toFixed(1)}% is significantly above national average.`,
        });
      }
    }

    econScore = {
      score,
      weight: 0.3,
      dataSource: "BIE market intelligence + local economic data",
      dataAvailable: true,
      detail: `Market trend: ${input.research.trendDirection}.${
        input.tradeArea?.unemploymentRate != null
          ? ` Local unemployment: ${(input.tradeArea.unemploymentRate * 100).toFixed(1)}%.`
          : ""
      }`,
    };
  } else {
    econScore = {
      score: 50,
      weight: 0.3,
      dataSource: "Insufficient data",
      dataAvailable: false,
      detail: "Local economic conditions not assessed.",
    };
  }

  // ── Real Estate Market ─────────────────────────────────────────────

  let reScore: DimensionScore;
  if (input.property?.hasIdentifiedLocation) {
    let score = 70;

    if (input.property.isLeaseNegotiated) score += 15;
    if (input.property.zonedCorrectly === true) score += 5;
    if (input.property.zonedCorrectly === false) {
      score -= 30;
      flags.push({
        severity: "critical",
        dimension: "realEstateMarket",
        message:
          "Proposed location is not correctly zoned for this business type.",
      });
    }
    if (input.property.parkingAdequate === false) {
      score -= 10;
      flags.push({
        severity: "warning",
        dimension: "realEstateMarket",
        message:
          "Parking at the proposed location may be inadequate for the business type.",
      });
    }

    score = Math.max(0, Math.min(100, score));

    reScore = {
      score,
      weight: 0.25,
      dataSource: "Borrower-provided property details",
      dataAvailable: true,
      detail: `Location identified: yes. Lease negotiated: ${
        input.property.isLeaseNegotiated ? "yes" : "no"
      }. Zoning: ${
        input.property.zonedCorrectly === true
          ? "confirmed"
          : input.property.zonedCorrectly === false
            ? "ISSUE"
            : "unverified"
      }.`,
    };
  } else {
    reScore = {
      score: 40,
      weight: 0.25,
      dataSource: "No specific location identified",
      dataAvailable: false,
      detail:
        "Borrower has not identified a specific property. Location-specific analysis is limited.",
    };
    flags.push({
      severity: "info",
      dimension: "realEstateMarket",
      message:
        "No specific property identified. Feasibility is assessed at the market level only.",
    });
  }

  // ── Access & Visibility ────────────────────────────────────────────

  let accessScore: DimensionScore;
  if (input.property?.trafficCountDaily != null) {
    const traffic = input.property.trafficCountDaily;
    let score = 50;
    if (traffic > 30_000) score = 90;
    else if (traffic > 20_000) score = 80;
    else if (traffic > 10_000) score = 65;
    else if (traffic > 5_000) score = 50;
    else score = 35;

    accessScore = {
      score,
      weight: 0.2,
      dataSource: "Traffic count data",
      dataAvailable: true,
      detail: `Daily traffic count: ${traffic.toLocaleString()} vehicles.`,
    };
  } else {
    accessScore = {
      score: 50,
      weight: 0.2,
      dataSource: "Not available",
      dataAvailable: false,
      detail:
        "Traffic count data not available. Access and visibility not quantified.",
    };
  }

  // ── Risk Exposure ──────────────────────────────────────────────────

  let riskScore: DimensionScore;
  if (input.research.areaSpecificRisks) {
    let score = 70;

    const riskText = input.research.areaSpecificRisks.toLowerCase();
    if (
      riskText.includes("flood") ||
      riskText.includes("hurricane") ||
      riskText.includes("wildfire")
    ) {
      score -= 15;
      flags.push({
        severity: "warning",
        dimension: "riskExposure",
        message:
          "Natural disaster exposure identified in trade area. Verify insurance availability and cost.",
      });
    }
    if (
      riskText.includes("single employer") ||
      riskText.includes("economic concentration")
    ) {
      score -= 10;
    }
    if (
      riskText.includes("crime") &&
      (riskText.includes("high") || riskText.includes("elevated"))
    ) {
      score -= 10;
    }

    score = Math.max(0, Math.min(100, score));

    riskScore = {
      score,
      weight: 0.25,
      dataSource: "BIE area risk assessment",
      dataAvailable: true,
      detail: "Area-specific risks assessed from research intelligence.",
    };
  } else {
    riskScore = {
      score: 50,
      weight: 0.25,
      dataSource: "Not assessed",
      dataAvailable: false,
      detail: "Area-specific risk assessment not available.",
    };
  }

  // ── Composite ──────────────────────────────────────────────────────

  const dimensions = [econScore, reScore, accessScore, riskScore];
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const weightedSum = dimensions.reduce(
    (s, d) => s + d.score * d.weight,
    0,
  );
  const overallScore = Math.round(weightedSum / totalWeight);

  return {
    overallScore,
    economicHealth: econScore,
    realEstateMarket: reScore,
    accessAndVisibility: accessScore,
    riskExposure: riskScore,
    dataCompleteness:
      dimensions.filter((d) => d.dataAvailable).length / dimensions.length,
    flags,
  };
}
