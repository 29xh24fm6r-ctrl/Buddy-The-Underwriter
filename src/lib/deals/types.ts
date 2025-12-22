export type DealStage = "New" | "Underwriting" | "Credit" | "Approved" | "Closed";

export type Deal = {
  id: string;
  name: string;
  subtitle: string; // "Austin, TX • Industrial"
  address?: string; // used in preview panel
  amount: number; // raw number
  stage: DealStage;
  riskRating: string; // "B-", "A", "C+"
  approvalProb: number; // 0-100
  leadInitials: string; // "JS"
  leadName: string; // "J. Smith"
  updatedLabel: string; // "2m ago" or "Today 09:42 AM"
  updatedNote?: string; // "Status Change"
  blocker?: "warning" | "critical" | null; // affects icon
  docCompleteness?: { done: number; total: number }; // e.g. 9/12
  
  // Additional fields for preview panel
  dscr?: string;
  ltv?: string;
  debtYield?: string;
  primaryRiskDriver?: string;
  nextAction?: string;
  nextActionCta?: string;
  documents?: Array<{
    name: string;
    status: "complete" | "pending" | "missing";
  }>;
};
