import type { IndustryProfile } from "../types";

export const MEDICAL_PROFILE: IndustryProfile = {
  naicsCode: "621",
  naicsDescription: "Physician offices, dental, outpatient care",
  displayName: "Medical / Healthcare",
  grossMarginNormal: { min: 0.55, max: 0.85 },
  grossMarginAnomaly: { min: 0.40, max: 0.92 },
  interestInCogs: false,
  interestInCogsNote: "Interest not typically embedded in COGS for medical practices",
  officerCompNormal: { min: 0.25, max: 0.65 },
  highDepreciationExpected: false,
  depreciationNote:
    "Medical equipment (imaging, diagnostic) may carry significant depreciation. Generally less than capital-intensive industries.",
  cogsComponents: [
    "Medical supplies",
    "Lab costs",
    "Medications dispensed",
    "Contract clinical staff",
  ],
  industryAddBacks: [
    {
      key: "PHYSICIAN_EXCESS_COMP",
      description: "Physician owner compensation above market rate",
      applicability:
        "When officer comp exceeds 50% of revenue — excess represents personal goodwill",
    },
  ],
  redFlags: [
    {
      id: "MEDICAL_AR_HIGH",
      description: "Implied AR >120 days of revenue",
      condition: "ACCOUNTS_RECEIVABLE > GROSS_RECEIPTS / 3",
      severity: "HIGH",
    },
    {
      id: "MEDICAL_COMP_EXTREME",
      description: "Officer comp >65% of revenue",
      condition: "OFFICER_COMPENSATION > GROSS_RECEIPTS * 0.65",
      severity: "MEDIUM",
    },
  ],
  creditAnalysisNotes:
    "Medical practices are physician-dependent — assess key-person risk. High officer comp is normal but verify reasonableness. Collections (AR) are critical — payer mix and days outstanding matter. Personal goodwill vs enterprise goodwill distinction important for succession and loan repayment.",
};
