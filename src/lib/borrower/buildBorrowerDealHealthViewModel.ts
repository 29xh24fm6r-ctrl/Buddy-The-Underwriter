/**
 * Borrower Deal Health Dashboard — View Model Builder
 *
 * Pure function that derives a production-grade deal health view
 * from real system state only. No fake metrics, no sample data,
 * no invented financials.
 *
 * Spec: 15G / Spec 3 — Borrower Deal Health Dashboard — Real Data Only
 *
 * Rules:
 * - Every metric must be backed by actual state
 * - Missing data → "unavailable" status, NOT fake low score
 * - No approval probability, credit scores, or funding guarantees
 * - All copy borrower-safe plain English
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BorrowerDealHealthStatus =
  | "strong"
  | "progressing"
  | "needs_attention"
  | "not_started"
  | "unavailable";

export type BorrowerDealHealthCategory = {
  id: string;
  label: string;
  score?: number;
  status: BorrowerDealHealthStatus;
  summary: string;
  confidence: "high" | "medium" | "low";
};

export type BorrowerReviewerPreviewItem = {
  id: string;
  label: string;
  description?: string;
  type: "strength" | "needed" | "clarification";
};

export type BorrowerFinancialSnapshot = {
  available: boolean;
  summary: string;
  periodsCovered?: string[];
  receivedStatementTypes?: string[];
  extractedFields?: string[];
};

export type BorrowerAttentionItem = {
  id: string;
  label: string;
  description?: string;
  priority: "required" | "helpful" | "optional";
  href?: string;
};

export type BorrowerDealHealthViewModel = {
  categories: BorrowerDealHealthCategory[];
  reviewerPreview: BorrowerReviewerPreviewItem[];
  financialSnapshot: BorrowerFinancialSnapshot;
  attentionItems: BorrowerAttentionItem[];
  summary: string;
};

// ---------------------------------------------------------------------------
// Input — reuses data available from journey + readiness inputs
// ---------------------------------------------------------------------------

export type DealHealthInput = {
  borrowerName?: string | null;

  /** Checklist */
  checklistRequired: number;
  checklistReceived: number;
  checklistMissing: number;

  /** Documents */
  docsUploaded: number;
  docsVerified: number;
  docsInFlight: boolean;

  /** Profile (0-1) */
  profileCompleteness: number;

  /** Ownership */
  ownershipVerified: boolean;

  /** SBA forms */
  sbaFormsReceived: number;
  sbaFormsRequired: number;

  /** Blockers */
  blockerCount: number;

  /** Missing items (borrower-safe) */
  missingItems: Array<{
    id: string;
    title: string;
    required: boolean;
    group?: string;
  }>;

  /** Completed items (borrower-safe) */
  completedItems: Array<{
    id: string;
    title: string;
  }>;

  /** Financial doc types received (e.g. "Tax Return", "P&L", "Balance Sheet") */
  financialDocTypes: string[];

  /** Fiscal periods covered (e.g. "2023", "2024 YTD") */
  financialPeriods: string[];

  /** Extracted financial field names if any (e.g. "revenue", "net_income") */
  extractedFinancialFields: string[];

  /** Portal stage */
  portalStage:
    | "getting_started"
    | "documents_requested"
    | "documents_received"
    | "buddy_reviewing"
    | "additional_items_needed"
    | "ready_for_sba_review";

  /** Token for upload links */
  token: string;
};

// ---------------------------------------------------------------------------
// Category builders — each grounded in real state
// ---------------------------------------------------------------------------

function ratioToStatus(
  received: number,
  required: number,
): BorrowerDealHealthStatus {
  if (required === 0) return "unavailable";
  const pct = received / required;
  if (pct >= 0.9) return "strong";
  if (pct >= 0.5) return "progressing";
  if (pct > 0) return "needs_attention";
  return "not_started";
}

function ratioToScore(received: number, required: number): number | undefined {
  if (required === 0) return undefined;
  return Math.round((received / required) * 100);
}

function buildDocumentCategory(input: DealHealthInput): BorrowerDealHealthCategory {
  const status = ratioToStatus(input.checklistReceived, input.checklistRequired);
  const score = ratioToScore(input.checklistReceived, input.checklistRequired);

  let summary: string;
  if (status === "unavailable") {
    summary = "Document requirements are being prepared.";
  } else if (status === "strong") {
    summary = "Nearly all requested documents have been received.";
  } else if (status === "progressing") {
    summary = `${input.checklistReceived} of ${input.checklistRequired} requested documents received.`;
  } else if (status === "needs_attention") {
    summary = `${input.checklistMissing} document${input.checklistMissing === 1 ? "" : "s"} still needed.`;
  } else {
    summary = "No documents have been uploaded yet.";
  }

  return {
    id: "documents",
    label: "Documentation Strength",
    score,
    status,
    summary,
    confidence: input.checklistRequired > 0 ? "high" : "low",
  };
}

function buildFinancialCategory(input: DealHealthInput): BorrowerDealHealthCategory {
  const hasFinancialDocs = input.financialDocTypes.length > 0;
  const hasExtractedFields = input.extractedFinancialFields.length > 0;

  let status: BorrowerDealHealthStatus;
  let summary: string;
  let score: number | undefined;

  if (!hasFinancialDocs) {
    status = "not_started";
    summary = "Financial documents have not been received yet.";
  } else if (hasExtractedFields) {
    status = input.financialDocTypes.length >= 2 ? "strong" : "progressing";
    score = Math.min(
      Math.round(
        ((input.financialDocTypes.length * 30 + input.extractedFinancialFields.length * 10) /
          100) *
          100,
      ),
      100,
    );
    summary = `${input.financialDocTypes.length} financial statement type${input.financialDocTypes.length === 1 ? "" : "s"} received and reviewed.`;
  } else {
    status = "progressing";
    summary = `${input.financialDocTypes.length} financial document${input.financialDocTypes.length === 1 ? "" : "s"} received. Review pending.`;
  }

  return {
    id: "financials",
    label: "Financial Package",
    score,
    status,
    summary,
    confidence: hasFinancialDocs ? (hasExtractedFields ? "high" : "medium") : "low",
  };
}

function buildSbaFormsCategory(input: DealHealthInput): BorrowerDealHealthCategory {
  const status = ratioToStatus(input.sbaFormsReceived, input.sbaFormsRequired);
  const score = ratioToScore(input.sbaFormsReceived, input.sbaFormsRequired);

  let summary: string;
  if (status === "unavailable") {
    summary = "SBA form requirements are being determined.";
  } else if (status === "strong") {
    summary = "All required SBA forms have been received.";
  } else if (status === "progressing") {
    summary = `${input.sbaFormsReceived} of ${input.sbaFormsRequired} required SBA forms received.`;
  } else if (status === "needs_attention") {
    const remaining = input.sbaFormsRequired - input.sbaFormsReceived;
    summary = `${remaining} SBA form${remaining === 1 ? "" : "s"} still needed.`;
  } else {
    summary = "SBA forms have not been submitted yet.";
  }

  return {
    id: "sba_forms",
    label: "SBA Forms",
    score,
    status,
    summary,
    confidence: input.sbaFormsRequired > 0 ? "high" : "low",
  };
}

function buildOwnershipCategory(input: DealHealthInput): BorrowerDealHealthCategory {
  const status: BorrowerDealHealthStatus = input.ownershipVerified
    ? "strong"
    : input.profileCompleteness > 0.3
      ? "needs_attention"
      : "not_started";

  return {
    id: "ownership",
    label: "Ownership & Identity",
    score: input.ownershipVerified ? 100 : undefined,
    status,
    summary: input.ownershipVerified
      ? "Owner details and identification have been verified."
      : "Ownership verification has not been completed yet.",
    confidence: input.ownershipVerified ? "high" : "medium",
  };
}

function buildProfileCategory(input: DealHealthInput): BorrowerDealHealthCategory {
  const pct = input.profileCompleteness;
  let status: BorrowerDealHealthStatus;
  if (pct >= 0.85) status = "strong";
  else if (pct >= 0.5) status = "progressing";
  else if (pct > 0) status = "needs_attention";
  else status = "not_started";

  return {
    id: "profile",
    label: "Review Readiness",
    score: Math.round(pct * 100),
    status,
    summary:
      status === "strong"
        ? "Business profile and package are approaching review readiness."
        : status === "progressing"
          ? "Business profile is partially complete."
          : status === "needs_attention"
            ? "Business profile needs additional information."
            : "Business profile has not been started.",
    confidence: pct > 0 ? "medium" : "low",
  };
}

function buildAttentionCategory(input: DealHealthInput): BorrowerDealHealthCategory {
  const count = input.blockerCount;
  let status: BorrowerDealHealthStatus;
  if (count === 0) status = "strong";
  else if (count <= 2) status = "progressing";
  else status = "needs_attention";

  return {
    id: "attention",
    label: "Open Attention Items",
    score: count === 0 ? 100 : Math.max(0, 100 - count * 15),
    status,
    summary:
      count === 0
        ? "No outstanding attention items."
        : `${count} item${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} attention before submission.`,
    confidence: "high",
  };
}

// ---------------------------------------------------------------------------
// Reviewer preview
// ---------------------------------------------------------------------------

function buildReviewerPreview(input: DealHealthInput): BorrowerReviewerPreviewItem[] {
  const items: BorrowerReviewerPreviewItem[] = [];

  // Strengths — only from real state
  if (input.checklistReceived > 0) {
    items.push({
      id: "rp_docs_received",
      label: `${input.checklistReceived} requested document${input.checklistReceived === 1 ? "" : "s"} received`,
      type: "strength",
    });
  }

  if (input.docsVerified > 0) {
    items.push({
      id: "rp_docs_verified",
      label: `${input.docsVerified} document${input.docsVerified === 1 ? "" : "s"} reviewed and filed`,
      type: "strength",
    });
  }

  if (input.ownershipVerified) {
    items.push({
      id: "rp_ownership",
      label: "Ownership verification completed",
      type: "strength",
    });
  }

  if (input.financialDocTypes.length > 0) {
    items.push({
      id: "rp_financials",
      label: `Financial documents on file: ${input.financialDocTypes.join(", ")}`,
      type: "strength",
    });
  }

  if (input.profileCompleteness >= 0.7) {
    items.push({
      id: "rp_profile",
      label: "Business profile substantially complete",
      type: "strength",
    });
  }

  // Needed items
  for (const item of input.missingItems.filter((i) => i.required).slice(0, 3)) {
    items.push({
      id: `rp_need_${item.id}`,
      label: item.title,
      description: "Required for lender submission.",
      type: "needed",
    });
  }

  // Clarifications
  if (input.docsInFlight) {
    items.push({
      id: "rp_inflight",
      label: "Recently uploaded documents are still being reviewed",
      description: "Buddy is checking these before adding them to the package.",
      type: "clarification",
    });
  }

  if (!input.ownershipVerified && input.profileCompleteness > 0.3) {
    items.push({
      id: "rp_ownership_needed",
      label: "Ownership details may need confirmation",
      description: "This is typically resolved during the review process.",
      type: "clarification",
    });
  }

  // Fallback if empty
  if (items.length === 0) {
    items.push({
      id: "rp_getting_started",
      label: "Your package is just getting started",
      description: "Buddy will populate this preview as documents are received.",
      type: "needed",
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Financial snapshot — real data only
// ---------------------------------------------------------------------------

function buildFinancialSnapshot(input: DealHealthInput): BorrowerFinancialSnapshot {
  const hasData =
    input.financialDocTypes.length > 0 || input.extractedFinancialFields.length > 0;

  if (!hasData) {
    return {
      available: false,
      summary:
        "Financial snapshot will appear after Buddy reviews uploaded financial documents.",
    };
  }

  const parts: string[] = [];
  if (input.financialDocTypes.length > 0) {
    parts.push(
      `${input.financialDocTypes.length} financial statement type${input.financialDocTypes.length === 1 ? "" : "s"} received`,
    );
  }
  if (input.financialPeriods.length > 0) {
    parts.push(`covering ${input.financialPeriods.join(", ")}`);
  }
  if (input.extractedFinancialFields.length > 0) {
    parts.push(
      `${input.extractedFinancialFields.length} data field${input.extractedFinancialFields.length === 1 ? "" : "s"} identified`,
    );
  }

  return {
    available: true,
    summary: `Buddy has reviewed your financial documents. ${parts.join(", ")}.`,
    periodsCovered:
      input.financialPeriods.length > 0 ? input.financialPeriods : undefined,
    receivedStatementTypes:
      input.financialDocTypes.length > 0 ? input.financialDocTypes : undefined,
    extractedFields:
      input.extractedFinancialFields.length > 0
        ? input.extractedFinancialFields
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Attention items
// ---------------------------------------------------------------------------

function buildAttentionItems(input: DealHealthInput): BorrowerAttentionItem[] {
  const items: BorrowerAttentionItem[] = [];

  // Required missing docs
  for (const missing of input.missingItems.filter((i) => i.required)) {
    items.push({
      id: `att_req_${missing.id}`,
      label: missing.title,
      description: "Required before lender submission.",
      priority: "required",
      href: `/upload/${input.token}`,
    });
  }

  // Profile completeness
  if (input.profileCompleteness < 0.7) {
    items.push({
      id: "att_profile",
      label: "Complete business profile",
      description: "A fuller profile helps reduce follow-up questions during review.",
      priority: "helpful",
    });
  }

  // Ownership
  if (!input.ownershipVerified) {
    items.push({
      id: "att_ownership",
      label: "Confirm ownership details",
      description: "Owner verification is part of the preparation process.",
      priority: "helpful",
    });
  }

  // Optional missing docs
  for (const missing of input.missingItems.filter((i) => !i.required).slice(0, 2)) {
    items.push({
      id: `att_opt_${missing.id}`,
      label: missing.title,
      description: "Optional but may strengthen your package.",
      priority: "optional",
      href: `/upload/${input.token}`,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function buildSummary(
  categories: BorrowerDealHealthCategory[],
  input: DealHealthInput,
): string {
  const strongCount = categories.filter((c) => c.status === "strong").length;
  const needsAttention = categories.filter(
    (c) => c.status === "needs_attention",
  ).length;
  const name = input.borrowerName?.split(" ")[0];

  if (strongCount >= 4) {
    return name
      ? `${name}, your package is well-prepared across most areas.`
      : "Your package is well-prepared across most areas.";
  }
  if (needsAttention >= 3) {
    return name
      ? `${name}, several areas need attention before your package is lender-ready.`
      : "Several areas need attention before your package is lender-ready.";
  }
  if (strongCount > 0) {
    return name
      ? `${name}, your package has real strengths and a few areas still being built.`
      : "Your package has real strengths and a few areas still being built.";
  }
  return name
    ? `${name}, Buddy is getting started on your deal health overview.`
    : "Buddy is getting started on your deal health overview.";
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildBorrowerDealHealthViewModel(
  input: DealHealthInput,
): BorrowerDealHealthViewModel {
  const categories: BorrowerDealHealthCategory[] = [
    buildDocumentCategory(input),
    buildFinancialCategory(input),
    buildSbaFormsCategory(input),
    buildOwnershipCategory(input),
    buildProfileCategory(input),
    buildAttentionCategory(input),
  ];

  const reviewerPreview = buildReviewerPreview(input);
  const financialSnapshot = buildFinancialSnapshot(input);
  const attentionItems = buildAttentionItems(input);
  const summary = buildSummary(categories, input);

  return {
    categories,
    reviewerPreview,
    financialSnapshot,
    attentionItems,
    summary,
  };
}
