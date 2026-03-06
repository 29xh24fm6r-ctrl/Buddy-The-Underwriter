import type { IndustryProfile } from "../types";

export const CONSTRUCTION_PROFILE: IndustryProfile = {
  naicsCode: "236",
  naicsDescription: "Building construction, specialty trades",
  displayName: "Construction",
  grossMarginNormal: { min: 0.15, max: 0.35 },
  grossMarginAnomaly: { min: 0.08, max: 0.50 },
  interestInCogs: true,
  interestInCogsNote:
    "Equipment financing interest often included in job costs",
  officerCompNormal: { min: 0.05, max: 0.25 },
  highDepreciationExpected: true,
  depreciationNote:
    "Heavy equipment, vehicles, and tools. Section 179 and bonus depreciation common. Equipment may be leased — verify operating vs capital leases.",
  cogsComponents: [
    "Materials",
    "Subcontractor costs",
    "Direct labor",
    "Equipment rental",
    "Job-site overhead",
    "Equipment financing interest",
  ],
  industryAddBacks: [],
  redFlags: [
    {
      id: "CONST_REVENUE_SPIKE",
      description:
        "Revenue increased >40% YOY without backlog explanation",
      condition: "currentRevenue > priorRevenue * 1.40",
      severity: "MEDIUM",
    },
    {
      id: "CONST_MARGIN_LOW",
      description:
        "Gross margin below 12% — possible unprofitable contracts",
      condition: "grossMargin < 0.12",
      severity: "HIGH",
    },
    {
      id: "CONST_WIP_UNDISCLOSED",
      description:
        "No WIP disclosure for a contractor with significant revenue",
      condition:
        "GROSS_RECEIPTS > 500000 AND no WIP schedule provided",
      severity: "MEDIUM",
    },
  ],
  creditAnalysisNotes:
    "Analyze revenue recognition method (completed contract vs percentage completion). WIP schedule is critical for larger contractors. Bonding capacity and surety relationship indicate creditworthiness. Equipment condition and age affect both operations and collateral. Subcontractor concentration risk.",
};
