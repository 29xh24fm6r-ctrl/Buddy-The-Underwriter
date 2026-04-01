export type DealIntelligence = {
  deal: {
    id: string;
    display_name?: string | null;
    nickname?: string | null;
    display_label: string;
    display_label_source: "display_name" | "nickname" | "borrower_name" | "name" | "fallback";
    needs_name: boolean;
    borrower_name: string;
    stage: string;
    risk_score: number | null;
    created_at: string | null;
    updated_at: string | null;
    loan_amount?: number | null;
  };
  checklist: {
    requiredTotal: number;
    receivedCount: number;
    pendingCount: number;
    missingKeys: string[];
    receivedKeys: string[];
    optionalMissingKeys: string[];
  };
  documents: {
    total: number;
    recent: Array<{
      id: string;
      label: string;
      original_filename: string;
      received_at: string | null;
      mime_type?: string | null;
      status?: string | null;
    }>;
  };
  activity: Array<{
    at: string | null;
    kind: string;
    label: string;
    detail?: string | null;
  }>;
  readiness: {
    score0to100: number;
    label: "Not Ready" | "Near Ready" | "Submission Ready";
    breakdown: {
      documents: number;
      financials: number;
      legal: number;
      collateral: number;
    };
    explainability: string[];
  };
  conditions: {
    open: Array<{
      key: string;
      label: string;
      status: string;
      requested_at?: string | null;
    }>;
    missingDocs: Array<{
      key: string;
      label: string;
      required: boolean;
    }>;
  };
  memoDraft: {
    title: string;
    generatedAt: string;
    executiveSummary: string;
    borrowerOverview: string;
    loanRequest: string;
    collateralSummary: string;
    documentChecklistStatus: string;
    riskFactors: string[];
    openItems: string[];
    recentActivity: string[];
    assumptions: string[];
  };
  assumptions: string[];
};
