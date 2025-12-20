export type UWContext = {
  deal_type?: string;
  loan_amount?: number;     // dollars
  ltv?: number;             // 0.00–1.00
  dscr?: number;            // e.g. 1.25
  global_dscr?: number;
  fico?: number;
  cash_injection?: number;  // 0.00–1.00
  property_type?: string;
  owner_occupied?: boolean;
  industry?: string;
  [k: string]: any;
};

export type PolicyMitigant = {
  key: string;
  label: string;
  priority?: number; // 1 highest
  note?: string;
};

export type PolicyExceptionTemplate = {
  title?: string;
  justification_prompt?: string;
  approvals?: string[]; // e.g. ["Credit Admin","CLO"]
};

export type PolicyRuleRow = {
  id: string;
  bank_id: string;
  rule_key: string;
  title: string;
  description: string | null;
  scope: any;
  predicate: any;
  decision: any;
  mitigants: PolicyMitigant[];
  exception_template: PolicyExceptionTemplate;
  severity: "hard" | "soft" | "info";
  active: boolean;
};

export type RuleEvaluation = {
  rule_id: string;
  rule_key: string;
  title: string;
  severity: "hard" | "soft" | "info";
  result: "pass" | "fail" | "warn" | "info";
  message: string;

  // Warn+continue: exception is optional; we treat it as "suggested when triggered"
  suggests_exception: boolean;

  mitigants: PolicyMitigant[];

  evidence: Array<{
    asset_id: string;
    chunk_id: string;
    page_num: number | null;
    section: string | null;
    snippet: string;
    note: string | null;
  }>;
};

export type PolicyEvaluationResult = {
  ok: true;
  bank_id: string;
  deal_id?: string;
  context: UWContext;
  summary: {
    warns: number;
    fails: number;
    infos: number;
    mitigants_total: number;
  };
  results: RuleEvaluation[];
  next_actions: Array<{
    key: string;
    label: string;
    priority: number;
    reason_rule_keys: string[];
  }>;
};
