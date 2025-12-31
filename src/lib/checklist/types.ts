export type ChecklistStatus = "missing" | "requested" | "pending" | "received" | "waived";

export type ChecklistDefinition = {
  checklist_key: string;
  title: string;
  required: boolean;
  description?: string | null;
  category?: string | null;
};

export type ChecklistRuleSet = {
  key: string;          // e.g. "CRE_OWNER_OCCUPIED_V1"
  loan_type_norm: string; // e.g. "CRE_OWNER_OCCUPIED"
  version: number;      // 1
  items: ChecklistDefinition[];
};

export type MatchResult = {
  matchedKey: string | null;
  confidence: number; // 0..1
  reason: string;
};
