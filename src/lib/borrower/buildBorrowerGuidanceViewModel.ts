/**
 * Borrower Guidance Engine — View Model Builder
 *
 * Deterministic, pure-function guidance layer that derives plain-English
 * coaching from real borrower/deal/document/readiness state.
 *
 * Spec: 15H / Spec 4 — Borrower Guidance Engine
 *
 * Rules:
 * - No AI-generated freeform text
 * - No external API calls
 * - No invented facts or approval promises
 * - Every output grounded in real input state
 * - Fully deterministic and testable
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BorrowerGuidanceFrictionSignal =
  | "not_started"
  | "many_items_remaining"
  | "blocked"
  | "waiting_for_review"
  | "ready_no_action_needed"
  | "needs_clarification"
  | "package_nearly_complete"
  | "low_readiness_with_uploads";

export type BorrowerGuidanceFocus =
  | "upload_required_document"
  | "complete_profile"
  | "resolve_blocker"
  | "wait_for_review"
  | "review_recommendations"
  | "confirm_information";

export type BorrowerGuidanceItem = {
  id: string;
  label: string;
  explanation: string;
  whyItMatters?: string;
  helpfulUploadHint?: string;
  commonIssueToAvoid?: string;
  href?: string;
  priority: "high" | "medium" | "low";
};

export type BorrowerGuidanceNextStep = {
  headline: string;
  description: string;
  ctaLabel?: string;
  href?: string;
  focus: BorrowerGuidanceFocus;
};

export type BorrowerGuidanceWhatHappensNext = {
  title: string;
  description: string;
};

export type BorrowerGuidanceReassurance = {
  tone: "positive" | "neutral" | "attention";
  message: string;
};

export type BorrowerGuidanceViewModel = {
  headline: string;
  summary: string;
  nextStep: BorrowerGuidanceNextStep;
  coachedItems: BorrowerGuidanceItem[];
  whatHappensNext: BorrowerGuidanceWhatHappensNext[];
  reassurance: BorrowerGuidanceReassurance;
  frictionSignals: BorrowerGuidanceFrictionSignal[];
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type GuidanceInput = {
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

  /** Blockers */
  blockerCount: number;

  /** Readiness score (0-100) */
  readinessScore: number;

  /** Missing items (borrower-safe titles) */
  missingItems: Array<{
    id: string;
    title: string;
    required: boolean;
  }>;

  /** Completed items */
  completedItems: Array<{
    id: string;
    title: string;
  }>;

  /** Has any activity events? */
  hasActivity: boolean;

  /** Recommendations count */
  recommendationCount: number;

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
// SBA Document Coaching Copy Map
// ---------------------------------------------------------------------------

type DocumentCoaching = {
  label: string;
  explanation: string;
  whyItMatters: string;
  helpfulUploadHint: string;
  commonIssueToAvoid?: string;
};

const COACHING_MAP: Record<string, DocumentCoaching> = {
  "business tax returns": {
    label: "Business tax returns",
    explanation:
      "Reviewers use business tax returns to understand operating history and verify reported revenue.",
    whyItMatters:
      "Tax returns are the primary evidence of business income and are required for nearly every SBA package.",
    helpfulUploadHint:
      "Include all pages and schedules for the requested years. A complete PDF from your accountant works best.",
    commonIssueToAvoid:
      "Partial returns missing schedules or K-1s often require re-upload.",
  },
  "personal tax returns": {
    label: "Personal tax returns",
    explanation:
      "Personal tax returns help reviewers evaluate guarantor income and personal financial capacity.",
    whyItMatters:
      "SBA lenders require personal returns from each owner with 20% or more ownership.",
    helpfulUploadHint:
      "Include the full return with all schedules, W-2s, and 1099s for each requested year.",
  },
  "personal financial statement": {
    label: "Personal Financial Statement",
    explanation:
      "This document summarizes your personal assets, liabilities, and net worth.",
    whyItMatters:
      "Lenders use this to evaluate guarantor capacity and global cash flow.",
    helpfulUploadHint:
      "Use the SBA form or your bank's template. Ensure all fields are filled and the form is signed.",
    commonIssueToAvoid:
      "Blank fields are often flagged for follow-up. Entering zero is better than leaving a field empty.",
  },
  "profit & loss": {
    label: "Profit & Loss statement",
    explanation:
      "A current P&L helps Buddy prepare a view of recent business performance.",
    whyItMatters:
      "Interim financials show how the business is performing right now, not just historically.",
    helpfulUploadHint:
      "Year-to-date P&L from your accounting software is ideal. Include month-by-month detail if possible.",
  },
  "balance sheet": {
    label: "Balance sheet",
    explanation:
      "A balance sheet shows business assets, liabilities, and equity at a point in time.",
    whyItMatters:
      "Reviewers use this to assess liquidity, leverage, and overall financial health.",
    helpfulUploadHint:
      "Provide the most recent balance sheet from your accounting system.",
  },
  "debt schedule": {
    label: "Current business debt schedule",
    explanation:
      "Helps reviewers understand existing business obligations and monthly payments.",
    whyItMatters:
      "A clear debt picture helps demonstrate how a new loan fits within existing capacity.",
    helpfulUploadHint:
      "List each obligation with lender, balance, monthly payment, maturity, and collateral.",
    commonIssueToAvoid:
      "Omitting small loans or credit lines can create discrepancies during review.",
  },
  "sba form 1919": {
    label: "SBA Form 1919",
    explanation:
      "This is the standard SBA borrower information form required for every application.",
    whyItMatters:
      "SBA requires this form as part of the authorization package before lender submission.",
    helpfulUploadHint:
      "Complete every section and ensure all owners with 20% or more ownership each submit one.",
  },
  "voided business check": {
    label: "Voided business check",
    explanation:
      "Confirms the business operating account details for SBA paperwork and funding setup.",
    whyItMatters:
      "Lenders verify the operating account before closing. This avoids delays at the end.",
    helpfulUploadHint:
      "A voided check from the primary business checking account. A bank-issued image is also fine.",
  },
  "business license": {
    label: "Business license or registration",
    explanation:
      "Confirms the business is legally registered and operating.",
    whyItMatters:
      "SBA lenders verify active business status as part of eligibility.",
    helpfulUploadHint:
      "Current state or local business license, articles of incorporation, or registration certificate.",
  },
  "lease agreement": {
    label: "Current lease agreement",
    explanation:
      "Shows the terms and cost of the business premises.",
    whyItMatters:
      "Lease obligations factor into cash flow analysis and debt capacity.",
    helpfulUploadHint:
      "Provide the full executed lease including amendments. Ensure rent amount and term are visible.",
  },
  "bank statements": {
    label: "Business bank statements",
    explanation:
      "Bank statements verify cash flow, deposits, and operating patterns.",
    whyItMatters:
      "Reviewers cross-reference bank activity with reported financials.",
    helpfulUploadHint:
      "Provide the most recent 3 months of statements for each business operating account.",
  },
  "purchase agreement": {
    label: "Purchase agreement or letter of intent",
    explanation:
      "Documents the terms of a business or asset acquisition.",
    whyItMatters:
      "Required for SBA loans that involve a business acquisition or change of ownership.",
    helpfulUploadHint:
      "Provide the signed agreement or LOI with purchase price, terms, and closing conditions.",
  },
  "entity documents": {
    label: "Entity formation documents",
    explanation:
      "Articles of incorporation, operating agreement, or partnership agreement.",
    whyItMatters:
      "Lenders verify ownership structure and entity type as part of SBA eligibility.",
    helpfulUploadHint:
      "Include articles of incorporation plus current operating or partnership agreement.",
  },
};

function findCoaching(title: string): DocumentCoaching | null {
  const lower = title.toLowerCase();
  for (const [key, coaching] of Object.entries(COACHING_MAP)) {
    if (lower.includes(key) || key.includes(lower)) {
      return coaching;
    }
  }
  // Partial keyword matches
  if (lower.includes("tax return") || lower.includes("tax returns"))
    return COACHING_MAP["business tax returns"];
  if (lower.includes("p&l") || lower.includes("profit"))
    return COACHING_MAP["profit & loss"];
  if (lower.includes("balance"))
    return COACHING_MAP["balance sheet"];
  if (lower.includes("debt"))
    return COACHING_MAP["debt schedule"];
  if (lower.includes("1919") || lower.includes("sba form"))
    return COACHING_MAP["sba form 1919"];
  if (lower.includes("check") || lower.includes("voided"))
    return COACHING_MAP["voided business check"];
  if (lower.includes("lease"))
    return COACHING_MAP["lease agreement"];
  if (lower.includes("bank statement"))
    return COACHING_MAP["bank statements"];
  if (lower.includes("purchase"))
    return COACHING_MAP["purchase agreement"];
  if (lower.includes("license"))
    return COACHING_MAP["business license"];
  if (lower.includes("entity") || lower.includes("articles") || lower.includes("operating agreement"))
    return COACHING_MAP["entity documents"];
  if (lower.includes("pfs") || lower.includes("personal financial"))
    return COACHING_MAP["personal financial statement"];
  if (lower.includes("personal tax"))
    return COACHING_MAP["personal tax returns"];

  return null;
}

// ---------------------------------------------------------------------------
// Friction detection
// ---------------------------------------------------------------------------

function detectFrictionSignals(input: GuidanceInput): BorrowerGuidanceFrictionSignal[] {
  const signals: BorrowerGuidanceFrictionSignal[] = [];

  if (input.completedItems.length === 0 && input.docsUploaded === 0) {
    signals.push("not_started");
  }

  if (input.checklistMissing >= 4) {
    signals.push("many_items_remaining");
  }

  if (input.blockerCount > 0 && input.portalStage === "additional_items_needed") {
    signals.push("blocked");
  }

  if (
    input.portalStage === "buddy_reviewing" ||
    input.portalStage === "ready_for_sba_review"
  ) {
    signals.push("waiting_for_review");
  }

  if (
    input.checklistMissing === 0 &&
    input.blockerCount === 0 &&
    input.portalStage === "ready_for_sba_review"
  ) {
    signals.push("ready_no_action_needed");
  }

  if (input.docsInFlight) {
    signals.push("needs_clarification");
  }

  if (
    input.checklistRequired > 0 &&
    input.checklistMissing <= 2 &&
    input.checklistMissing > 0
  ) {
    signals.push("package_nearly_complete");
  }

  if (input.docsUploaded >= 3 && input.readinessScore < 30) {
    signals.push("low_readiness_with_uploads");
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Adaptive focus
// ---------------------------------------------------------------------------

function determineFocus(input: GuidanceInput): BorrowerGuidanceFocus {
  const requiredMissing = input.missingItems.filter((i) => i.required);

  if (input.blockerCount > 0 && requiredMissing.length > 0) {
    return "resolve_blocker";
  }
  if (requiredMissing.length > 0) {
    return "upload_required_document";
  }
  if (input.profileCompleteness < 0.5) {
    return "complete_profile";
  }
  if (input.recommendationCount > 0 && input.checklistMissing === 0) {
    return "review_recommendations";
  }
  if (!input.ownershipVerified && input.profileCompleteness >= 0.5) {
    return "confirm_information";
  }
  return "wait_for_review";
}

// ---------------------------------------------------------------------------
// Headline + summary
// ---------------------------------------------------------------------------

function buildHeadline(input: GuidanceInput, focus: BorrowerGuidanceFocus): string {
  const name = input.borrowerName?.split(" ")[0];

  switch (focus) {
    case "upload_required_document": {
      const count = input.missingItems.filter((i) => i.required).length;
      return name
        ? `${name}, ${count} item${count === 1 ? "" : "s"} needed to keep moving.`
        : `${count} item${count === 1 ? "" : "s"} needed to keep moving.`;
    }
    case "resolve_blocker":
      return name
        ? `${name}, a few items need your attention.`
        : "A few items need your attention.";
    case "complete_profile":
      return name
        ? `${name}, completing your profile helps Buddy prepare faster.`
        : "Completing your profile helps Buddy prepare faster.";
    case "wait_for_review":
      return name
        ? `${name}, your package is moving forward.`
        : "Your package is moving forward.";
    case "review_recommendations":
      return name
        ? `${name}, Buddy has suggestions that may strengthen your package.`
        : "Buddy has suggestions that may strengthen your package.";
    case "confirm_information":
      return name
        ? `${name}, confirming a few details will keep things on track.`
        : "Confirming a few details will keep things on track.";
  }
}

function buildSummary(input: GuidanceInput, focus: BorrowerGuidanceFocus): string {
  switch (focus) {
    case "upload_required_document":
      return "Buddy has received several key items and is checking what else may be needed before lender submission.";
    case "resolve_blocker":
      return "Your package has progress, but a few items are blocking the next step. Addressing them keeps things moving.";
    case "complete_profile":
      return "A more complete business profile means fewer follow-up questions and a smoother review process.";
    case "wait_for_review":
      return "Buddy is reviewing your documents and organizing the package. No borrower action is needed right now.";
    case "review_recommendations":
      return "Your required items are in good shape. Optional recommendations below may help speed up review.";
    case "confirm_information":
      return "Most items are on file. Confirming ownership and contact details will help finalize the package.";
  }
}

// ---------------------------------------------------------------------------
// Next step
// ---------------------------------------------------------------------------

function buildNextStep(
  input: GuidanceInput,
  focus: BorrowerGuidanceFocus,
): BorrowerGuidanceNextStep {
  const requiredMissing = input.missingItems.filter((i) => i.required);

  switch (focus) {
    case "upload_required_document":
    case "resolve_blocker": {
      const first = requiredMissing[0];
      const coaching = first ? findCoaching(first.title) : null;
      return {
        headline: first
          ? `Upload your ${coaching?.label ?? first.title.toLowerCase()}`
          : "Upload the next requested document",
        description: coaching?.explanation ??
          "This helps Buddy prepare the lender package and may reduce follow-up questions.",
        ctaLabel: first ? `Upload ${coaching?.label ?? first.title}` : "Upload document",
        href: `/upload/${input.token}`,
        focus,
      };
    }
    case "complete_profile":
      return {
        headline: "Complete your business profile",
        description:
          "A fuller profile means fewer follow-up questions and faster review.",
        ctaLabel: "Update profile",
        focus,
      };
    case "review_recommendations":
      return {
        headline: "Review Buddy's recommendations",
        description:
          "Optional items that may strengthen your package are listed below.",
        focus,
      };
    case "confirm_information":
      return {
        headline: "Confirm ownership and contact details",
        description:
          "Verifying this information helps finalize the package for submission.",
        focus,
      };
    case "wait_for_review":
      return {
        headline: "No action needed right now",
        description:
          "Buddy is reviewing your package and will surface new items here if anything else is needed.",
        focus,
      };
  }
}

// ---------------------------------------------------------------------------
// Coached missing items (max 3)
// ---------------------------------------------------------------------------

function buildCoachedItems(input: GuidanceInput): BorrowerGuidanceItem[] {
  const requiredMissing = input.missingItems.filter((i) => i.required);
  const items = requiredMissing.slice(0, 3);

  return items.map((item) => {
    const coaching = findCoaching(item.title);
    return {
      id: `coached_${item.id}`,
      label: coaching?.label ?? item.title,
      explanation:
        coaching?.explanation ??
        "This document helps Buddy prepare a more complete lender package.",
      whyItMatters: coaching?.whyItMatters,
      helpfulUploadHint: coaching?.helpfulUploadHint,
      commonIssueToAvoid: coaching?.commonIssueToAvoid,
      href: `/upload/${input.token}`,
      priority: "high" as const,
    };
  });
}

// ---------------------------------------------------------------------------
// What happens next
// ---------------------------------------------------------------------------

function buildWhatHappensNext(input: GuidanceInput): BorrowerGuidanceWhatHappensNext[] {
  const steps: BorrowerGuidanceWhatHappensNext[] = [];

  if (input.docsInFlight) {
    steps.push({
      title: "Document review in progress",
      description:
        "Buddy is checking your uploaded documents for completeness.",
    });
  }

  if (input.checklistMissing > 0) {
    steps.push({
      title: "Remaining items",
      description:
        "Once required items are received, Buddy can help prepare the lender package.",
    });
  }

  if (
    input.portalStage === "buddy_reviewing" ||
    input.portalStage === "ready_for_sba_review"
  ) {
    steps.push({
      title: "Package review",
      description:
        "Your banker may review remaining attention items before lender submission.",
    });
  }

  if (input.checklistMissing === 0 && input.blockerCount === 0) {
    steps.push({
      title: "Submission preparation",
      description:
        "Buddy is organizing your documents for the next step in the process.",
    });
  }

  // Always provide at least one step
  if (steps.length === 0) {
    steps.push({
      title: "Getting started",
      description:
        "No borrower action is needed right now. Buddy will surface new items if needed.",
    });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Reassurance
// ---------------------------------------------------------------------------

function buildReassurance(
  input: GuidanceInput,
  frictionSignals: BorrowerGuidanceFrictionSignal[],
): BorrowerGuidanceReassurance {
  if (frictionSignals.includes("ready_no_action_needed")) {
    return {
      tone: "positive",
      message:
        "No major blockers detected right now. Your completed items are saved and your package is moving forward.",
    };
  }

  if (frictionSignals.includes("waiting_for_review")) {
    return {
      tone: "positive",
      message:
        "Buddy is reviewing your package and will surface next steps here. You do not need to re-upload documents unless Buddy requests them.",
    };
  }

  if (frictionSignals.includes("package_nearly_complete")) {
    return {
      tone: "positive",
      message:
        "Your package is nearly complete. Just a few more items and Buddy can move forward with preparation.",
    };
  }

  if (frictionSignals.includes("blocked")) {
    return {
      tone: "attention",
      message:
        "Your package has real progress, but some items still need attention before the next step. Addressing them keeps things on track.",
    };
  }

  if (frictionSignals.includes("low_readiness_with_uploads")) {
    return {
      tone: "neutral",
      message:
        "Buddy has received your uploads and is checking what else may be needed. Additional required items will appear in your checklist.",
    };
  }

  if (frictionSignals.includes("not_started")) {
    return {
      tone: "neutral",
      message:
        "Your SBA package is being set up. Buddy will list the first requested items here as soon as they are ready.",
    };
  }

  return {
    tone: "neutral",
    message:
      "Buddy is organizing your package and will post updates here. Your submitted items are securely saved.",
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildBorrowerGuidanceViewModel(
  input: GuidanceInput,
): BorrowerGuidanceViewModel {
  const frictionSignals = detectFrictionSignals(input);
  const focus = determineFocus(input);
  const headline = buildHeadline(input, focus);
  const summary = buildSummary(input, focus);
  const nextStep = buildNextStep(input, focus);
  const coachedItems = buildCoachedItems(input);
  const whatHappensNext = buildWhatHappensNext(input);
  const reassurance = buildReassurance(input, frictionSignals);

  return {
    headline,
    summary,
    nextStep,
    coachedItems,
    whatHappensNext,
    reassurance,
    frictionSignals,
  };
}
