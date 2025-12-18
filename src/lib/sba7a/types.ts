export type SbaEligibilityStatus = "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";

export type SbaEligibilityReason = {
  code: string;        // stable machine code
  message: string;     // borrower-friendly explanation
  severity: "BLOCK" | "INFO";
};

export type SbaEligibilityMissing = {
  key: string;         // answer key we need
  question: string;    // what to ask next
};

export type SbaEligibilityResult = {
  status: SbaEligibilityStatus;
  candidate: boolean;               // SBA candidate based on intent
  best_program: "SBA_7A" | "CONVENTIONAL" | "UNKNOWN";
  reasons: SbaEligibilityReason[];
  missing: SbaEligibilityMissing[];
};
