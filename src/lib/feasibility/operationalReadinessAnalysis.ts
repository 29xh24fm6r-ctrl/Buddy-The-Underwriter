import "server-only";

// src/lib/feasibility/operationalReadinessAnalysis.ts
// Phase God Tier Feasibility — Operational Readiness dimension (step 5/16).
// Pure function. Scores management experience, industry knowledge, staffing,
// and (for franchise deals) franchise support.

import type {
  DimensionScore,
  MarketFlag,
  OperationalReadinessInput,
  OperationalReadinessScore,
} from "./types";

export function analyzeOperationalReadiness(
  input: OperationalReadinessInput,
): OperationalReadinessScore {
  const flags: MarketFlag[] = [];

  // ── Management Experience ──────────────────────────────────────────

  const maxExperience = Math.max(
    0,
    ...input.managementTeam.map((m) => m.yearsInIndustry),
  );
  const totalExperience = input.managementTeam.reduce(
    (s, m) => s + m.yearsInIndustry,
    0,
  );
  const hasOperator = input.managementTeam.some(
    (m) => m.yearsInIndustry >= 5,
  );
  const hasBio = input.managementTeam.some((m) => m.bio.length > 20);

  let mgmtScore = 40;
  if (maxExperience >= 15) mgmtScore = 95;
  else if (maxExperience >= 10) mgmtScore = 85;
  else if (maxExperience >= 5) mgmtScore = 70;
  else if (maxExperience >= 2) mgmtScore = 55;
  else if (maxExperience > 0) mgmtScore = 40;
  else mgmtScore = 20;

  if (!hasOperator && !input.isFranchise) {
    flags.push({
      severity: "warning",
      dimension: "managementExperience",
      message:
        "No team member has 5+ years in the industry. First-time operators carry higher execution risk.",
    });
  }

  const managementExperience: DimensionScore = {
    score: mgmtScore,
    weight: input.isFranchise ? 0.3 : 0.4,
    dataSource: "SBA assumption interview — management team",
    dataAvailable: input.managementTeam.length > 0,
    detail: `Lead operator: ${maxExperience} years in industry. Team total: ${totalExperience} years across ${input.managementTeam.length} member(s).`,
  };

  // ── Industry Knowledge ─────────────────────────────────────────────

  let industryScore = 50;
  if (input.managementIntelligence && input.managementValidated) {
    industryScore = 75;
  } else if (input.managementIntelligence) {
    industryScore = 60;
  }
  if (hasBio) industryScore = Math.min(100, industryScore + 10);

  const industryKnowledge: DimensionScore = {
    score: industryScore,
    weight: 0.25,
    dataSource: "BIE management intelligence + assumption interview bios",
    dataAvailable: input.managementTeam.length > 0,
    detail: `Management profiles ${
      input.managementValidated ? "verified" : "unverified"
    } via BIE research. ${hasBio ? "Detailed bios provided." : "No detailed bios."}`,
  };

  // ── Staffing Readiness ─────────────────────────────────────────────

  let staffingScore = 60;
  if (input.plannedHires.length > 0) {
    const firstHireMonth = Math.min(
      ...input.plannedHires.map((h) => h.startMonth),
    );
    if (firstHireMonth <= 1) staffingScore = 80;
    if (input.plannedHires.length >= 3)
      staffingScore = Math.min(90, staffingScore + 10);
    staffingScore = Math.min(100, staffingScore);
  }

  const staffingReadiness: DimensionScore = {
    score: staffingScore,
    weight: 0.15,
    dataSource: "SBA assumption interview — planned hires",
    dataAvailable: true,
    detail: `${input.plannedHires.length} planned hire(s). ${
      input.plannedHires.length > 0
        ? `First hire in month ${Math.min(
            ...input.plannedHires.map((h) => h.startMonth),
          )}.`
        : "No additional hires planned."
    }`,
  };

  // ── Franchise Support ──────────────────────────────────────────────

  let franchiseScore: DimensionScore;
  if (input.isFranchise) {
    let score = 60;
    if (
      input.franchiseTrainingWeeks != null &&
      input.franchiseTrainingWeeks >= 4
    )
      score += 15;
    if (
      input.franchiseTrainingWeeks != null &&
      input.franchiseTrainingWeeks >= 8
    )
      score += 10;
    if (input.franchiseOperationsManual) score += 10;
    if (input.franchiseOngoingSupport) score += 5;
    score = Math.min(100, score);

    franchiseScore = {
      score,
      weight: 0.3,
      dataSource: "FDD franchise support data",
      dataAvailable: true,
      detail: `Training: ${
        input.franchiseTrainingWeeks ?? "unknown"
      } weeks. Operations manual: ${
        input.franchiseOperationsManual ? "yes" : "unknown"
      }. Ongoing support: ${input.franchiseOngoingSupport ?? "not specified"}.`,
    };
  } else {
    franchiseScore = {
      score: 0,
      weight: 0,
      dataSource: "N/A — not a franchise",
      dataAvailable: false,
      detail: "Non-franchise deal — franchise support dimension not scored.",
    };
  }

  // ── Composite ──────────────────────────────────────────────────────

  const dimensions = [
    managementExperience,
    industryKnowledge,
    staffingReadiness,
    ...(input.isFranchise ? [franchiseScore] : []),
  ];
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const weightedSum = dimensions.reduce(
    (s, d) => s + d.score * d.weight,
    0,
  );
  const overallScore = Math.round(weightedSum / totalWeight);

  return {
    overallScore,
    managementExperience,
    industryKnowledge,
    staffingReadiness,
    franchiseSupport: franchiseScore,
    dataCompleteness:
      dimensions.filter((d) => d.dataAvailable).length / dimensions.length,
    flags,
  };
}
