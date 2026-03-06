import type { IndustryProfile } from "../types";

export const MARITIME_PROFILE: IndustryProfile = {
  naicsCode: "487210",
  naicsDescription: "Scenic and sightseeing transportation, water",
  displayName: "Maritime / Charter Boats",
  grossMarginNormal: { min: 0.40, max: 0.75 },
  grossMarginAnomaly: { min: 0.25, max: 0.85 },
  interestInCogs: true,
  interestInCogsNote:
    "Boat financing interest commonly included in COGS via Form 1125-A",
  officerCompNormal: { min: 0.05, max: 0.30 },
  highDepreciationExpected: true,
  depreciationNote:
    "Vessels and marine equipment depreciate heavily. Section 179 and bonus depreciation common. EBITDA add-back typically significant.",
  cogsComponents: [
    "Fuel",
    "Crew wages",
    "Marina/dock fees",
    "Provisions",
    "Vessel maintenance",
    "Charter commissions",
    "Equipment rental",
  ],
  industryAddBacks: [
    {
      key: "VESSEL_INTEREST",
      description: "Interest on vessel financing embedded in COGS",
      applicability:
        "When Form 1125-A shows interest as a COGS component",
    },
  ],
  redFlags: [
    {
      id: "MARITIME_REVENUE_DECLINE",
      description: "Revenue declined >20% YOY",
      condition:
        "priorYearRevenue available AND currentRevenue < priorYearRevenue * 0.80",
      severity: "MEDIUM",
    },
    {
      id: "MARITIME_COGS_NO_INTEREST",
      description: "COGS present but no interest expense found anywhere",
      condition:
        "COST_OF_GOODS_SOLD > 0 AND INTEREST_EXPENSE === null",
      severity: "MEDIUM",
    },
    {
      id: "MARITIME_MARGIN_LOW",
      description:
        "Gross margin below 35% — possible misclassification of operating expenses as COGS",
      condition: "grossMargin < 0.35",
      severity: "HIGH",
    },
  ],
  creditAnalysisNotes:
    "Charter boat businesses are seasonal and weather-dependent. Analyze 3 years minimum. Verify vessel condition and insurance. Check USCG documentation. Interest embedded in COGS via 1125-A is common — always check. Depreciation add-back is typically the largest EBITDA adjustment.",
};
