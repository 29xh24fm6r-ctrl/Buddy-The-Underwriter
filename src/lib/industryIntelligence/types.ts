export type IndustryProfile = {
  naicsCode: string;
  naicsDescription: string;
  displayName: string;
  grossMarginNormal: { min: number; max: number };
  grossMarginAnomaly: { min: number; max: number };
  interestInCogs: boolean;
  interestInCogsNote: string;
  officerCompNormal: { min: number; max: number };
  highDepreciationExpected: boolean;
  depreciationNote: string;
  cogsComponents: string[];
  industryAddBacks: Array<{
    key: string;
    description: string;
    applicability: string;
  }>;
  redFlags: Array<{
    id: string;
    description: string;
    condition: string;
    severity: "HIGH" | "MEDIUM" | "LOW";
  }>;
  creditAnalysisNotes: string;
};
