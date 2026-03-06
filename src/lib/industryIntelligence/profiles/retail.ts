import type { IndustryProfile } from "../types";

export const RETAIL_PROFILE: IndustryProfile = {
  naicsCode: "44",
  naicsDescription: "Retail trade",
  displayName: "Retail",
  grossMarginNormal: { min: 0.25, max: 0.55 },
  grossMarginAnomaly: { min: 0.15, max: 0.70 },
  interestInCogs: false,
  interestInCogsNote: "Interest not typically embedded in COGS for retail",
  officerCompNormal: { min: 0.03, max: 0.20 },
  highDepreciationExpected: false,
  depreciationNote:
    "Leasehold improvements, fixtures, and equipment. Generally moderate.",
  cogsComponents: [
    "Merchandise cost",
    "Freight in",
    "Inventory shrinkage",
    "Purchasing costs",
  ],
  industryAddBacks: [],
  redFlags: [
    {
      id: "RETAIL_INVENTORY_HIGH",
      description: "Inventory >90 days of COGS",
      condition: "INVENTORY > COST_OF_GOODS_SOLD / 4",
      severity: "MEDIUM",
    },
    {
      id: "RETAIL_MARGIN_DECLINE",
      description: "Gross margin declined >5 points YOY",
      condition:
        "priorYearMargin available AND currentMargin < priorYearMargin - 0.05",
      severity: "MEDIUM",
    },
  ],
  creditAnalysisNotes:
    "Inventory quality and turnover are critical. Verify inventory method (FIFO, LIFO, weighted average). Lease terms and location are key operating factors. E-commerce competition impact on brick-and-mortar. Days inventory outstanding vs industry norm.",
};
