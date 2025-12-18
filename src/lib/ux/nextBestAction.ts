import "server-only";

/**
 * Next Best Action Types
 * Deterministic priority-based actions for deal progression
 */
export type NextActionType =
  | "ASSIGN_UNDERWRITER"
  | "RUN_WORKER_TICK"
  | "RUN_OCR_ALL"
  | "REVIEW_DRAFT_REQUESTS"
  | "REVIEW_DRAFT_MESSAGES"
  | "REQUEST_MISSING_DOCS"
  | "GENERATE_BANK_FORM"
  | "REVIEW_CONDITIONS"
  | "READY_TO_CLOSE"
  | "NONE";

export type NextAction = {
  type: NextActionType;
  title: string;
  subtitle: string;
  ctaLabel?: string;
  ctaHref?: string;
  ctaAction?: "POST" | "GET";
  ctaBody?: any;
  severity: "INFO" | "WARNING" | "SUCCESS";
  evidence?: Record<string, any>;
};

export type DealSignals = {
  dealId: string;

  // participants
  hasUnderwriter: boolean;

  // jobs
  queuedJobs: number;
  runningJobs: number;
  failedJobs: number;

  // uploads
  eligibleUploads: number;
  ocrCompletedCount: number;

  // conditions
  conditionsOutstanding: number;
  conditionsCritical: number;
  conditionsHigh: number;
  lastEvaluatedAt?: string | null;

  // messaging
  draftMessages: number;

  // forms
  formsReadyToGenerate: number;

  // draft requests (new system)
  draftRequestsPending: number;
};

/**
 * Compute Next Best Action
 * Pure deterministic logic - no AI involved
 * Priority ordered from most blocking to least
 */
export function computeNextBestAction(s: DealSignals): NextAction {
  // 1) Missing underwriter assignment blocks everything operationally
  if (!s.hasUnderwriter) {
    return {
      type: "ASSIGN_UNDERWRITER",
      title: "Assign an underwriter",
      subtitle: "This deal isn't owned yet. Assigning an underwriter enables accountability and workload tracking.",
      ctaLabel: "Assign underwriter",
      ctaHref: `/deals/${s.dealId}#assignees`,
      severity: "WARNING",
      evidence: { hasUnderwriter: s.hasUnderwriter },
    };
  }

  // 2) Failed jobs should be seen early
  if (s.failedJobs > 0) {
    return {
      type: "RUN_WORKER_TICK",
      title: "Recover failed document processing",
      subtitle: `${s.failedJobs} job(s) failed. Re-run the worker to retry and restore pipeline health.`,
      ctaLabel: "Run worker now",
      ctaAction: "POST",
      ctaHref: `/api/jobs/worker/tick`,
      ctaBody: { deal_id: s.dealId, limit: 25 },
      severity: "WARNING",
      evidence: { failedJobs: s.failedJobs },
    };
  }

  // 3) If uploads exist but OCR isn't done, run OCR-all
  const needsOcr = s.eligibleUploads > 0 && s.ocrCompletedCount < s.eligibleUploads;
  if (needsOcr) {
    return {
      type: "RUN_OCR_ALL",
      title: "Process documents (OCR + classify)",
      subtitle: `You have ${s.eligibleUploads - s.ocrCompletedCount} file(s) not yet processed. Running this updates conditions automatically.`,
      ctaLabel: "Run OCR on all",
      ctaAction: "POST",
      ctaHref: `/api/deals/${s.dealId}/uploads/ocr-all`,
      ctaBody: {},
      severity: "INFO",
      evidence: { eligibleUploads: s.eligibleUploads, ocrCompletedCount: s.ocrCompletedCount },
    };
  }

  // 4) Draft borrower requests need approval (new system)
  if (s.draftRequestsPending > 0) {
    return {
      type: "REVIEW_DRAFT_REQUESTS",
      title: "Review Draft Borrower Requests",
      subtitle: `${s.draftRequestsPending} draft request(s) pending approval. Auto-generated from missing CTC conditions.`,
      ctaLabel: "Review Drafts",
      ctaHref: `/deals/${s.dealId}#drafts`,
      severity: "INFO",
      evidence: { draftRequestsPending: s.draftRequestsPending },
    };
  }

  // 5) If borrower nudges are drafted, review them (human approval - old system)
  if (s.draftMessages > 0) {
    return {
      type: "REVIEW_DRAFT_MESSAGES",
      title: "Review drafted borrower messages",
      subtitle: `${s.draftMessages} message(s) are ready for approval. Approve only what you want sent.`,
      ctaLabel: "Review messages",
      ctaHref: `/deals/${s.dealId}#messages`,
      severity: "INFO",
      evidence: { draftMessages: s.draftMessages },
    };
  }

  // 6) If conditions are critical/high, focus there
  if (s.conditionsCritical > 0) {
    return {
      type: "REVIEW_CONDITIONS",
      title: "Resolve critical closing blockers",
      subtitle: `${s.conditionsCritical} critical condition(s) are outstanding.`,
      ctaLabel: "View conditions",
      ctaHref: `/deals/${s.dealId}#conditions`,
      severity: "WARNING",
      evidence: { conditionsCritical: s.conditionsCritical },
    };
  }
  if (s.conditionsOutstanding > 0) {
    // 7) if forms ready, next best might be generate a form
    if (s.formsReadyToGenerate > 0) {
      return {
        type: "GENERATE_BANK_FORM",
        title: "Generate bank forms",
        subtitle: `${s.formsReadyToGenerate} form(s) are ready. Generate now to speed underwriting.`,
        ctaLabel: "Open bank forms",
        ctaHref: `/deals/${s.dealId}#bank-forms`,
        severity: "INFO",
        evidence: { formsReadyToGenerate: s.formsReadyToGenerate },
      };
    }
    return {
      type: "REVIEW_CONDITIONS",
      title: "Advance the deal checklist",
      subtitle: `${s.conditionsOutstanding} condition(s) remain. Clearing these increases closing readiness.`,
      ctaLabel: "View conditions",
      ctaHref: `/deals/${s.dealId}#conditions`,
      severity: "INFO",
      evidence: { conditionsOutstanding: s.conditionsOutstanding },
    };
  }

  // 6) If nothing is blocking, celebrate
  return {
    type: "READY_TO_CLOSE",
    title: "Ready for closing",
    subtitle: "All tracked conditions are satisfied based on deterministic evidence checks.",
    severity: "SUCCESS",
    evidence: { conditionsOutstanding: s.conditionsOutstanding },
  };
}
