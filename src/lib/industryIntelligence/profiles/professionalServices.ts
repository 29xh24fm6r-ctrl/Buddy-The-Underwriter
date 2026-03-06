import type { IndustryProfile } from "../types";

export const PROFESSIONAL_SERVICES_PROFILE: IndustryProfile = {
  naicsCode: "541",
  naicsDescription: "Legal, accounting, consulting, engineering, IT services",
  displayName: "Professional Services",
  grossMarginNormal: { min: 0.65, max: 0.92 },
  grossMarginAnomaly: { min: 0.50, max: 0.98 },
  interestInCogs: false,
  interestInCogsNote:
    "Interest not typically embedded in COGS for professional services",
  officerCompNormal: { min: 0.20, max: 0.55 },
  highDepreciationExpected: false,
  depreciationNote:
    "Computers, office equipment only. Generally minimal.",
  cogsComponents: [
    "Direct labor (if tracked separately)",
    "Subcontractors",
    "Software licenses",
    "Direct project costs",
  ],
  industryAddBacks: [],
  redFlags: [
    {
      id: "PROSERV_DSO_HIGH",
      description: "Days sales outstanding >90 days",
      condition:
        "ACCOUNTS_RECEIVABLE / (GROSS_RECEIPTS / 365) > 90",
      severity: "HIGH",
    },
    {
      id: "PROSERV_CLIENT_CONCENTRATION",
      description:
        "Revenue concentration risk — single client may exceed 30%",
      condition:
        "cannot be auto-detected from tax return alone — flag for analyst inquiry",
      severity: "MEDIUM",
    },
    {
      id: "PROSERV_REVENUE_DECLINE",
      description: "Revenue declined >15% YOY",
      condition: "currentRevenue < priorRevenue * 0.85",
      severity: "MEDIUM",
    },
  ],
  creditAnalysisNotes:
    "Revenue is people-dependent — assess key-person risk and employee retention. Client concentration is the primary credit risk — ask for top-5 client revenue breakdown. AR quality matters — government clients pay slow, corporate clients vary. Non-compete and non-solicitation agreements affect enterprise value.",
};
