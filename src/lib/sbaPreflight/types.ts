export type PreflightIssue = {
  code: string;
  message: string;
  severity: "BLOCK" | "WARN";
  evidence?: {
    source: "ANSWER" | "FORM" | "DOCUMENT" | "CHECKLIST";
    ref?: string; // question_key, doc_type, form field, etc.
  };
};

export type PreflightResult = {
  score: number;
  passed: boolean;
  blocking_issues: PreflightIssue[];
  warnings: PreflightIssue[];
};
