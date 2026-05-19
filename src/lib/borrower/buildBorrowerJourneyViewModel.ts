/**
 * Borrower Funding Progress Journey — View Model Builder
 *
 * Pure function that derives a borrower-facing progress journey from
 * existing portal / deal / checklist / document state.
 *
 * Spec: 15F / Spec 1 — Borrower Funding Progress Journey
 *
 * Rules:
 * - No internal lifecycle enums leak to borrower copy
 * - No fake completion claims — conservative fallback only
 * - All labels borrower-safe plain English
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BorrowerJourneyStage =
  | "started_application"
  | "business_profile"
  | "ownership_identity"
  | "financial_documents"
  | "sba_forms"
  | "buddy_review"
  | "banker_review"
  | "ready_for_lender_submission";

export type MilestoneStatus = "completed" | "current" | "blocked" | "upcoming";

export type BorrowerJourneyMilestone = {
  id: BorrowerJourneyStage;
  label: string;
  description: string;
  status: MilestoneStatus;
};

export type BorrowerJourneyAction = {
  id: string;
  label: string;
  description?: string;
  ctaLabel?: string;
  href?: string;
  severity?: "critical" | "important" | "recommended";
};

export type BorrowerJourneyViewModel = {
  currentStage: BorrowerJourneyStage;
  progressPercent: number;
  statusSummary: string;
  milestones: BorrowerJourneyMilestone[];
  completedItems: BorrowerJourneyAction[];
  remainingItems: BorrowerJourneyAction[];
  blockers: BorrowerJourneyAction[];
  nextBestAction?: BorrowerJourneyAction;
};

// ---------------------------------------------------------------------------
// Input — the data we can derive from existing portal state
// ---------------------------------------------------------------------------

export type JourneyInput = {
  /** Deal / application name if available */
  dealName?: string | null;
  /** Borrower first name */
  borrowerName?: string | null;

  /** Checklist counts */
  checklistRequired: number;
  checklistReceived: number;
  checklistMissing: number;

  /** Document upload state */
  docsUploaded: number;
  /** Are any docs still processing? */
  docsInFlight: boolean;

  /** Missing checklist items (borrower-safe titles) */
  missingItems: Array<{
    id: string;
    title: string;
    required: boolean;
    group?: string;
  }>;

  /** Completed checklist items (borrower-safe titles) */
  completedItems: Array<{
    id: string;
    title: string;
  }>;

  /** Portal-derived stage (from existing deriveSafeBorrowerStage) */
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
// Milestone definitions
// ---------------------------------------------------------------------------

const MILESTONE_DEFS: Array<{
  id: BorrowerJourneyStage;
  label: string;
  description: string;
}> = [
  {
    id: "started_application",
    label: "Started Application",
    description: "Your SBA funding application has been created.",
  },
  {
    id: "business_profile",
    label: "Business Profile",
    description: "Basic business information is on file.",
  },
  {
    id: "ownership_identity",
    label: "Ownership & Identity",
    description: "Owner details and identification are captured.",
  },
  {
    id: "financial_documents",
    label: "Financial Documents",
    description: "Tax returns, financials, and supporting documents.",
  },
  {
    id: "sba_forms",
    label: "SBA Forms",
    description: "Required SBA forms and disclosures.",
  },
  {
    id: "buddy_review",
    label: "Buddy Review",
    description: "Buddy is reviewing and organizing your package.",
  },
  {
    id: "banker_review",
    label: "Banker Review",
    description: "Your banker is reviewing the completed package.",
  },
  {
    id: "ready_for_lender_submission",
    label: "Ready for Lender Submission",
    description: "Package is prepared for lender submission.",
  },
];

// ---------------------------------------------------------------------------
// Stage mapping — map existing portalStage to journey stage
// ---------------------------------------------------------------------------

function mapPortalStageToJourneyStage(
  portalStage: JourneyInput["portalStage"],
  input: JourneyInput,
): BorrowerJourneyStage {
  switch (portalStage) {
    case "getting_started":
      return "started_application";
    case "documents_requested": {
      // If some docs have been uploaded, we're past business_profile
      if (input.docsUploaded > 0) return "financial_documents";
      return "business_profile";
    }
    case "documents_received":
    case "additional_items_needed":
      return "financial_documents";
    case "buddy_reviewing":
      return "buddy_review";
    case "ready_for_sba_review":
      return "banker_review";
    default:
      return "started_application";
  }
}

// ---------------------------------------------------------------------------
// Progress percentage
// ---------------------------------------------------------------------------

function computeProgressPercent(input: JourneyInput): number {
  // Base: 10% for starting
  let progress = 10;

  // Checklist completion drives 60% of the bar
  if (input.checklistRequired > 0) {
    const checklistPct =
      (input.checklistReceived / input.checklistRequired) * 60;
    progress += Math.round(checklistPct);
  }

  // Having uploaded docs adds up to 10%
  if (input.docsUploaded > 0) {
    progress += Math.min(input.docsUploaded * 2, 10);
  }

  // Review stages add progress
  if (
    input.portalStage === "buddy_reviewing" ||
    input.portalStage === "ready_for_sba_review"
  ) {
    progress += 15;
  }

  // Ready for SBA review is near-complete
  if (input.portalStage === "ready_for_sba_review") {
    progress += 5;
  }

  return Math.min(Math.max(progress, 0), 100);
}

// ---------------------------------------------------------------------------
// Status summary (borrower-friendly)
// ---------------------------------------------------------------------------

function buildStatusSummary(input: JourneyInput, progressPct: number): string {
  const name = input.borrowerName?.split(" ")[0] ?? "";
  const greeting = name ? `${name}, your` : "Your";

  if (input.portalStage === "getting_started") {
    return `${greeting} SBA funding package is getting started. Buddy will post the first document requests here shortly.`;
  }

  if (input.portalStage === "ready_for_sba_review") {
    return `${greeting} SBA funding package is with the review team. Buddy will update this page if anything else is needed.`;
  }

  if (input.checklistMissing > 0) {
    return `${greeting} SBA funding package is ${progressPct}% complete. Upload ${input.checklistMissing} more item${input.checklistMissing === 1 ? "" : "s"} to keep moving toward lender submission.`;
  }

  if (input.docsInFlight) {
    return `${greeting} SBA funding package is ${progressPct}% complete. Buddy is reviewing your latest uploads now.`;
  }

  return `${greeting} SBA funding package is ${progressPct}% complete.`;
}

// ---------------------------------------------------------------------------
// Milestones with status
// ---------------------------------------------------------------------------

function buildMilestones(
  currentStage: BorrowerJourneyStage,
  input: JourneyInput,
): BorrowerJourneyMilestone[] {
  const currentIndex = MILESTONE_DEFS.findIndex((m) => m.id === currentStage);
  const hasBlockers =
    input.checklistMissing > 0 &&
    input.portalStage === "additional_items_needed";

  return MILESTONE_DEFS.map((def, index) => {
    let status: MilestoneStatus;
    if (index < currentIndex) {
      status = "completed";
    } else if (index === currentIndex) {
      status = hasBlockers ? "blocked" : "current";
    } else {
      status = "upcoming";
    }
    return { ...def, status };
  });
}

// ---------------------------------------------------------------------------
// Completed items (borrower-safe accomplishments)
// ---------------------------------------------------------------------------

function buildCompletedItems(
  input: JourneyInput,
): BorrowerJourneyAction[] {
  const items: BorrowerJourneyAction[] = [];

  // Always: application started
  items.push({
    id: "app_started",
    label: "Application started",
    description: "Your SBA funding application has been created.",
  });

  if (input.docsUploaded > 0) {
    items.push({
      id: "docs_uploaded",
      label: `${input.docsUploaded} document${input.docsUploaded === 1 ? "" : "s"} uploaded`,
      description:
        "Buddy has received your uploads and is organizing them into the package.",
    });
  }

  // Each completed checklist item
  for (const item of input.completedItems) {
    items.push({
      id: `checklist_${item.id}`,
      label: item.title,
      description: "Received and filed in your SBA package.",
    });
  }

  if (
    input.portalStage === "buddy_reviewing" ||
    input.portalStage === "ready_for_sba_review"
  ) {
    items.push({
      id: "package_in_review",
      label: "Package entered review",
      description: "Buddy is organizing your documents for the next step.",
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Remaining items
// ---------------------------------------------------------------------------

function buildRemainingItems(
  input: JourneyInput,
): BorrowerJourneyAction[] {
  if (input.missingItems.length === 0) {
    return [
      {
        id: "fallback_remaining",
        label: "Buddy is reviewing your package",
        description:
          "Buddy is reviewing your package and will surface the next required items here.",
      },
    ];
  }

  return input.missingItems.map((item) => ({
    id: `missing_${item.id}`,
    label: item.title,
    description: item.required
      ? "Required for your SBA package."
      : "Recommended but not required.",
    ctaLabel: "Upload",
    href: `/upload/${input.token}`,
    severity: item.required
      ? ("critical" as const)
      : ("recommended" as const),
  }));
}

// ---------------------------------------------------------------------------
// Blockers
// ---------------------------------------------------------------------------

function buildBlockers(input: JourneyInput): BorrowerJourneyAction[] {
  if (input.portalStage !== "additional_items_needed") return [];

  const criticalMissing = input.missingItems.filter((item) => item.required);
  if (criticalMissing.length === 0) return [];

  return criticalMissing.slice(0, 3).map((item) => ({
    id: `blocker_${item.id}`,
    label: item.title,
    description: "This document is needed before Buddy can move your package forward.",
    ctaLabel: "Upload now",
    href: `/upload/${input.token}`,
    severity: "critical" as const,
  }));
}

// ---------------------------------------------------------------------------
// Next best action
// ---------------------------------------------------------------------------

function buildNextBestAction(
  input: JourneyInput,
): BorrowerJourneyAction | undefined {
  // Priority 1: critical missing docs
  const criticalMissing = input.missingItems.filter((item) => item.required);
  if (criticalMissing.length > 0) {
    const first = criticalMissing[0];
    return {
      id: `nba_${first.id}`,
      label: `Upload your ${first.title}`,
      description:
        "This helps Buddy complete the review and move your package toward lender submission.",
      ctaLabel: `Upload ${first.title}`,
      href: `/upload/${input.token}`,
      severity: "critical",
    };
  }

  // Priority 2: recommended items
  const recommended = input.missingItems.filter((item) => !item.required);
  if (recommended.length > 0) {
    const first = recommended[0];
    return {
      id: `nba_${first.id}`,
      label: `Upload your ${first.title}`,
      description:
        "This optional document can strengthen your SBA package.",
      ctaLabel: `Upload ${first.title}`,
      href: `/upload/${input.token}`,
      severity: "recommended",
    };
  }

  // Priority 3: docs in flight — wait
  if (input.docsInFlight) {
    return {
      id: "nba_wait",
      label: "Buddy is reviewing your latest uploads",
      description:
        "Your documents are being reviewed. Buddy will update this page with the next step.",
      severity: "recommended",
    };
  }

  // Priority 4: package complete — review underway
  if (
    input.portalStage === "buddy_reviewing" ||
    input.portalStage === "ready_for_sba_review"
  ) {
    return {
      id: "nba_review",
      label: "Your package is being reviewed",
      description:
        "Buddy is organizing your documents. No action needed from you right now.",
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildBorrowerJourneyViewModel(
  input: JourneyInput,
): BorrowerJourneyViewModel {
  const currentStage = mapPortalStageToJourneyStage(input.portalStage, input);
  const progressPercent = computeProgressPercent(input);
  const statusSummary = buildStatusSummary(input, progressPercent);
  const milestones = buildMilestones(currentStage, input);
  const completedItems = buildCompletedItems(input);
  const remainingItems = buildRemainingItems(input);
  const blockers = buildBlockers(input);
  const nextBestAction = buildNextBestAction(input);

  return {
    currentStage,
    progressPercent,
    statusSummary,
    milestones,
    completedItems,
    remainingItems,
    blockers,
    nextBestAction,
  };
}
