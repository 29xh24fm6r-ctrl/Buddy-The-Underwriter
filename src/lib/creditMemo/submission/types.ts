// Pure types for the credit memo submission gate.
// No imports of server-only modules — safe for CI guard tests.

export type ReadinessRequiredKey =
  | "dscr_computed"
  | "loan_amount"
  | "collateral_value"
  | "business_description"
  | "management_bio";

export type ReadinessWarningKey =
  | "ai_narrative_missing"
  | "research_missing"
  | "covenant_review_missing"
  | "qualitative_review_missing";

export type ReadinessBlocker = {
  code: ReadinessRequiredKey;
  label: string;
  owner: "banker" | "borrower" | "buddy";
  fixHref?: string;
};

export type ReadinessWarning = {
  code: ReadinessWarningKey;
  label: string;
};

export type MemoReadinessContract = {
  passed: boolean;
  required: Record<ReadinessRequiredKey, boolean>;
  warnings: Record<ReadinessWarningKey, boolean>;
  blockers: ReadinessBlocker[];
  warningList: ReadinessWarning[];
  evaluatedAt: string;
  contractVersion: "memo_readiness_v1";
};

export type MemoSubmissionFailureReason =
  | "readiness_failed"
  | "memo_load_failed"
  | "tenant_mismatch"
  | "missing_banker_id"
  | "persist_failed";

export type MemoSubmissionResult =
  | {
      ok: true;
      snapshotId: string;
      memoVersion: number;
      readiness: MemoReadinessContract;
      inputHash: string;
    }
  | {
      ok: false;
      reason: MemoSubmissionFailureReason;
      readiness?: MemoReadinessContract;
      error?: string;
    };

export type BankerCertification = {
  banker_id: string;
  certified_at: string;
  reviewed_tabs: string[];
  acknowledged_warnings: ReadinessWarningKey[];
  banker_notes: string | null;
  qualitative_overrides_present: boolean;
  covenant_adjustments_present: boolean;
};

export type DataSourcesManifest = {
  canonical_memo_generated_at: string;
  overrides_keys: string[];
  financial_snapshot_present: boolean;
  research_present: boolean;
  pricing_decision_present: boolean;
};
