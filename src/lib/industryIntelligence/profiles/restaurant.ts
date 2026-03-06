import type { IndustryProfile } from "../types";

export const RESTAURANT_PROFILE: IndustryProfile = {
  naicsCode: "722",
  naicsDescription: "Restaurants, food service, bars",
  displayName: "Restaurant / Food Service",
  grossMarginNormal: { min: 0.55, max: 0.75 },
  grossMarginAnomaly: { min: 0.45, max: 0.85 },
  interestInCogs: false,
  interestInCogsNote: "Interest not typically embedded in COGS for restaurants",
  officerCompNormal: { min: 0.05, max: 0.20 },
  highDepreciationExpected: false,
  depreciationNote:
    "Kitchen equipment, furniture, some buildout. Generally moderate.",
  cogsComponents: [
    "Food cost",
    "Beverage cost",
    "Paper/packaging supplies",
  ],
  industryAddBacks: [],
  redFlags: [
    {
      id: "REST_FOOD_COST_HIGH",
      description: "Food cost ratio exceeds 42% of revenue",
      condition: "COST_OF_GOODS_SOLD / GROSS_RECEIPTS > 0.42",
      severity: "HIGH",
    },
    {
      id: "REST_LABOR_HIGH",
      description: "Labor cost exceeds 35% of revenue",
      condition: "SALARIES_WAGES / GROSS_RECEIPTS > 0.35",
      severity: "MEDIUM",
    },
    {
      id: "REST_PRIME_COST_HIGH",
      description:
        "Prime cost (food + labor) exceeds 70% of revenue",
      condition:
        "(COST_OF_GOODS_SOLD + SALARIES_WAGES) / GROSS_RECEIPTS > 0.70",
      severity: "HIGH",
    },
  ],
  creditAnalysisNotes:
    "Prime cost (food + labor) is the primary operating metric. Typical target <65%. Lease terms critical — percentage rent clauses affect cash flow. 3-year minimum analysis essential given restaurant volatility. COVID and supply chain impacts on prior years. Verify liquor license status if applicable.",
};
