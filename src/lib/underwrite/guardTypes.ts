// src/lib/underwrite/guardTypes.ts

export type GuardSeverity = "BLOCKED" | "WARN" | "READY";

export type FixTarget =
  | { kind: "banker_loan_products"; dealId: string }
  | { kind: "borrower_portal_request"; dealId: string }
  | { kind: "documents_upload"; dealId: string }
  | { kind: "deal_cockpit"; dealId: string }
  | { kind: "borrower_attachment"; dealId: string };

export type GuardIssue = {
  code: string;
  severity: "BLOCKED" | "WARN";
  title: string;
  detail: string;
  fix: {
    label: string;
    target: FixTarget;
  };
};

export type UnderwriteGuardResult = {
  dealId: string;
  severity: GuardSeverity;
  issues: GuardIssue[];
  // quick stats for UI
  stats: {
    blockedCount: number;
    warnCount: number;
  };
};
