import type { IndustryProfile } from "../types";

export const REAL_ESTATE_PROFILE: IndustryProfile = {
  naicsCode: "531",
  naicsDescription: "Real estate lessors, managers, agents",
  displayName: "Real Estate",
  grossMarginNormal: { min: 0.55, max: 0.90 },
  grossMarginAnomaly: { min: 0.40, max: 0.95 },
  interestInCogs: false,
  interestInCogsNote:
    "Interest on line 15, mortgage interest separate — not embedded in COGS",
  officerCompNormal: { min: 0.02, max: 0.25 },
  highDepreciationExpected: true,
  depreciationNote:
    "Real property depreciated over 27.5 or 39 years. Improvement depreciation can be significant. Cost segregation studies may accelerate depreciation.",
  cogsComponents: [
    "Property management fees",
    "Maintenance and repairs",
    "Utilities (landlord-paid)",
    "Property insurance",
    "HOA fees",
  ],
  industryAddBacks: [
    {
      key: "RE_DEPRECIATION",
      description: "Real property and improvement depreciation",
      applicability: "Always — non-cash charge, standard add-back",
    },
    {
      key: "RE_AMORTIZATION",
      description: "Loan cost amortization",
      applicability: "When present",
    },
  ],
  redFlags: [
    {
      id: "RE_VACANCY_IMPLIED",
      description: "Implied vacancy rate exceeds 15%",
      condition:
        "rental income significantly below market rate for disclosed sq footage",
      severity: "MEDIUM",
    },
    {
      id: "RE_MORTGAGE_HEAVY",
      description: "Interest expense >40% of NOI",
      condition:
        "INTEREST_EXPENSE > (ORDINARY_BUSINESS_INCOME + INTEREST_EXPENSE) * 0.40",
      severity: "HIGH",
    },
  ],
  creditAnalysisNotes:
    "Analyze on NOI basis, not EBITDA. Key metrics: NOI, cap rate, DSCR on property debt. Depreciation always added back. Verify occupancy and lease terms. Market rent vs actual rent comparison important.",
};
