import type { IndustryProfile } from "../types";

export const DEFAULT_PROFILE: IndustryProfile = {
  naicsCode: "000000",
  naicsDescription: "Unknown or unmapped industry",
  displayName: "Unknown Industry",
  grossMarginNormal: { min: 0.20, max: 0.80 },
  grossMarginAnomaly: { min: 0.05, max: 0.95 },
  interestInCogs: false,
  interestInCogsNote:
    "Industry unknown — verify interest expense location manually",
  officerCompNormal: { min: 0.02, max: 0.50 },
  highDepreciationExpected: false,
  depreciationNote: "Industry unknown — apply standard depreciation analysis.",
  cogsComponents: [],
  industryAddBacks: [],
  redFlags: [],
  creditAnalysisNotes:
    "Industry not recognized. Apply standard credit analysis. Consider requesting industry-specific benchmarks from borrower or trade association.",
};
