/**
 * Borrower Readiness Intelligence Layer — View Model Builder
 *
 * Pure function that derives readiness scoring, deal insights,
 * recommendations, and activity from existing portal / deal state.
 *
 * Spec: 15F / Spec 2 — Borrower Readiness Intelligence Layer
 *
 * Rules:
 * - No internal lifecycle enums leak to borrower copy
 * - Readiness = operational completeness, NOT credit approval
 * - No fake precision or implied approval odds
 * - All labels borrower-safe plain English
 * - Conservative derivation from real state only
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BorrowerReadinessBand =
  | "early_stage"
  | "progressing"
  | "strong_progress"
  | "near_submission_ready";

export type BorrowerReadinessScore = {
  score: number;
  band: BorrowerReadinessBand;
  summary: string;
  delta?: number;
};

export type BorrowerDealInsight = {
  id: string;
  label: string;
  description?: string;
  type: "positive" | "progress" | "verification" | "document";
};

export type BorrowerRecommendation = {
  id: string;
  label: string;
  explanation?: string;
  priority: "high" | "medium" | "low";
  href?: string;
};

export type BorrowerActivityEvent = {
  id: string;
  label: string;
  timestamp: string;
  category: "upload" | "review" | "verification" | "milestone" | "request";
};

export type BorrowerReadinessViewModel = {
  readiness: BorrowerReadinessScore;
  insights: BorrowerDealInsight[];
  recommendations: BorrowerRecommendation[];
  activity: BorrowerActivityEvent[];
  documentCompletionPercent: number;
  documentStats: {
    received: number;
    underReview: number;
    remaining: number;
  };
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type ReadinessInput = {
  /** Borrower name for personalized copy */
  borrowerName?: string | null;

  /** Checklist counts */
  checklistRequired: number;
  checklistReceived: number;
  checklistMissing: number;

  /** Document state */
  docsUploaded: number;
  docsInFlight: boolean;
  docsVerified: number;

  /** Profile completeness (0-1) */
  profileCompleteness: number;

  /** Ownership verified? */
  ownershipVerified: boolean;

  /** SBA forms status */
  sbaFormsReceived: number;
  sbaFormsRequired: number;

  /** How many blockers exist */
  blockerCount: number;

  /** Missing items (borrower-safe titles) */
  missingItems: Array<{
    id: string;
    title: string;
    required: boolean;
    group?: string;
  }>;

  /** Completed items (borrower-safe titles) */
  completedItems: Array<{
    id: string;
    title: string;
  }>;

  /** Raw activity from portal (already borrower-safe) */
  activity: Array<{
    id: string;
    title: string;
    detail: string;
    createdAt: string;
    kind: "upload" | "review" | "request" | "package";
  }>;

  /** Portal stage */
  portalStage:
    | "getting_started"
    | "documents_requested"
    | "documents_received"
    | "buddy_reviewing"
    | "additional_items_needed"
    | "ready_for_sba_review";

  /** Upload token for CTA links */
  token: string;

  /** Previous readiness score (for delta) */
  previousScore?: number;
};

// ---------------------------------------------------------------------------
// Readiness scoring
// ---------------------------------------------------------------------------

const READINESS_WEIGHTS = {
  documentCompleteness: 0.35,
  profileCompleteness: 0.15,
  ownershipVerification: 0.10,
  sbaFormsCompletion: 0.15,
  financialPackage: 0.15,
  blockerPenalty: 0.10,
} as const;

function computeReadinessScore(input: ReadinessInput): number {
  const docScore =
    input.checklistRequired > 0
      ? input.checklistReceived / input.checklistRequired
      : 0;

  const profileScore = Math.min(input.profileCompleteness, 1);

  const ownershipScore = input.ownershipVerified ? 1 : 0;

  const sbaScore =
    input.sbaFormsRequired > 0
      ? input.sbaFormsReceived / input.sbaFormsRequired
      : 0;

  // Financial package = verified docs as fraction of uploaded
  const financialScore =
    input.docsUploaded > 0
      ? Math.min(input.docsVerified / Math.max(input.docsUploaded, 1), 1)
      : 0;

  // Blocker penalty: each blocker costs 10% of the blocker weight
  const blockerPenalty = Math.min(input.blockerCount * 0.1, 1);
  const blockerScore = 1 - blockerPenalty;

  const raw =
    docScore * READINESS_WEIGHTS.documentCompleteness +
    profileScore * READINESS_WEIGHTS.profileCompleteness +
    ownershipScore * READINESS_WEIGHTS.ownershipVerification +
    sbaScore * READINESS_WEIGHTS.sbaFormsCompletion +
    financialScore * READINESS_WEIGHTS.financialPackage +
    blockerScore * READINESS_WEIGHTS.blockerPenalty;

  // Convert to 0-100 and clamp
  return Math.min(Math.max(Math.round(raw * 100), 0), 100);
}

function scoreToBand(score: number): BorrowerReadinessBand {
  if (score >= 80) return "near_submission_ready";
  if (score >= 55) return "strong_progress";
  if (score >= 25) return "progressing";
  return "early_stage";
}

const BAND_LABELS: Record<BorrowerReadinessBand, string> = {
  early_stage: "Early Stage",
  progressing: "Progressing",
  strong_progress: "Strong Progress",
  near_submission_ready: "Near Submission Ready",
};

function buildReadinessSummary(
  score: number,
  band: BorrowerReadinessBand,
  input: ReadinessInput,
): string {
  const name = input.borrowerName?.split(" ")[0];

  if (band === "near_submission_ready") {
    return name
      ? `${name}, your package is approaching lender-review readiness.`
      : "Your package is approaching lender-review readiness.";
  }
  if (band === "strong_progress") {
    return name
      ? `${name}, your SBA package is building strong momentum.`
      : "Your SBA package is building strong momentum.";
  }
  if (band === "progressing") {
    return name
      ? `${name}, your package is taking shape. Keep adding the requested items.`
      : "Your package is taking shape. Keep adding the requested items.";
  }
  return name
    ? `${name}, we're getting started on your SBA package. The first steps matter most.`
    : "We're getting started on your SBA package. The first steps matter most.";
}

function buildReadinessScore(
  input: ReadinessInput,
): BorrowerReadinessScore {
  const score = computeReadinessScore(input);
  const band = scoreToBand(score);
  const summary = buildReadinessSummary(score, band, input);
  const delta =
    input.previousScore != null ? score - input.previousScore : undefined;

  return { score, band, summary, delta };
}

// ---------------------------------------------------------------------------
// Deal insights (positive momentum)
// ---------------------------------------------------------------------------

function buildInsights(input: ReadinessInput): BorrowerDealInsight[] {
  const insights: BorrowerDealInsight[] = [];

  if (input.docsUploaded >= 3) {
    insights.push({
      id: "docs_substantial",
      label: "Financial package substantially started",
      description:
        "Multiple documents are in your package, giving Buddy more to work with.",
      type: "document",
    });
  }

  if (input.ownershipVerified) {
    insights.push({
      id: "ownership_verified",
      label: "Ownership verification completed",
      description: "Owner identity and structure have been confirmed.",
      type: "verification",
    });
  }

  if (input.profileCompleteness >= 0.8) {
    insights.push({
      id: "profile_strong",
      label: "Business profile is well established",
      description:
        "Most business information is on file, reducing follow-up questions.",
      type: "positive",
    });
  }

  if (input.sbaFormsRequired > 0 && input.sbaFormsReceived >= input.sbaFormsRequired) {
    insights.push({
      id: "sba_forms_complete",
      label: "Required SBA forms received",
      description: "All required SBA forms and disclosures are in the package.",
      type: "document",
    });
  }

  if (input.docsVerified > 0) {
    insights.push({
      id: "docs_reviewed",
      label: `${input.docsVerified} document${input.docsVerified === 1 ? "" : "s"} reviewed and filed`,
      description:
        "Buddy has reviewed and organized these into your package.",
      type: "progress",
    });
  }

  if (
    input.checklistRequired > 0 &&
    input.checklistReceived / input.checklistRequired >= 0.5
  ) {
    insights.push({
      id: "checklist_halfway",
      label: "More than half of requested items received",
      description: "Your package is past the halfway mark for requested documents.",
      type: "progress",
    });
  }

  if (input.completedItems.length > 0 && insights.length === 0) {
    insights.push({
      id: "progress_started",
      label: "Package preparation underway",
      description: "Buddy has started organizing your submitted documents.",
      type: "progress",
    });
  }

  // Safe fallback
  if (insights.length === 0) {
    insights.push({
      id: "getting_started",
      label: "Your SBA journey has begun",
      description:
        "Buddy will highlight positive developments here as your package grows.",
      type: "positive",
    });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Recommendations (AI concierge)
// ---------------------------------------------------------------------------

function buildRecommendations(
  input: ReadinessInput,
): BorrowerRecommendation[] {
  const recs: BorrowerRecommendation[] = [];

  // Prioritize required missing items
  const requiredMissing = input.missingItems.filter((i) => i.required);
  const optionalMissing = input.missingItems.filter((i) => !i.required);

  for (const item of requiredMissing.slice(0, 2)) {
    recs.push({
      id: `rec_${item.id}`,
      label: `Uploading your ${item.title.toLowerCase()} could accelerate review`,
      explanation: `This is a required item for your SBA package. Providing it now helps Buddy move your package forward without delays.`,
      priority: "high",
      href: `/upload/${input.token}`,
    });
  }

  // Add one optional if we have room
  if (recs.length < 3 && optionalMissing.length > 0) {
    const opt = optionalMissing[0];
    recs.push({
      id: `rec_opt_${opt.id}`,
      label: `Providing ${opt.title.toLowerCase()} may reduce follow-up requests`,
      explanation: `This supporting document is not required but can strengthen your package.`,
      priority: "medium",
      href: `/upload/${input.token}`,
    });
  }

  // Profile completeness recommendation
  if (recs.length < 3 && input.profileCompleteness < 0.7) {
    recs.push({
      id: "rec_profile",
      label: "Completing your business profile helps Buddy prepare faster",
      explanation:
        "A complete business profile reduces the number of follow-up questions during review.",
      priority: "medium",
    });
  }

  // Ownership recommendation
  if (recs.length < 3 && !input.ownershipVerified) {
    recs.push({
      id: "rec_ownership",
      label: "Confirming ownership details strengthens your application",
      explanation:
        "Owner verification is part of the SBA preparation process. Completing it early keeps your timeline on track.",
      priority: "medium",
    });
  }

  // Safe fallback
  if (recs.length === 0) {
    recs.push({
      id: "rec_fallback",
      label: "Your package is progressing well",
      explanation:
        "Buddy will surface the highest-impact next steps here as your package evolves.",
      priority: "low",
    });
  }

  return recs.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Activity feed (borrower-safe)
// ---------------------------------------------------------------------------

function mapActivityKindToCategory(
  kind: "upload" | "review" | "request" | "package",
): BorrowerActivityEvent["category"] {
  switch (kind) {
    case "upload":
      return "upload";
    case "review":
      return "review";
    case "request":
      return "request";
    case "package":
      return "milestone";
  }
}

function buildActivityFeed(
  input: ReadinessInput,
): BorrowerActivityEvent[] {
  // Map existing portal activity to readiness activity format
  return input.activity.slice(0, 8).map((item) => ({
    id: item.id,
    label: item.title,
    timestamp: item.createdAt,
    category: mapActivityKindToCategory(item.kind),
  }));
}

// ---------------------------------------------------------------------------
// Document completion stats
// ---------------------------------------------------------------------------

function buildDocumentStats(input: ReadinessInput) {
  const received = input.checklistReceived;
  const underReview = input.docsInFlight
    ? Math.max(input.docsUploaded - input.docsVerified, 0)
    : 0;
  const remaining = input.checklistMissing;
  const total = Math.max(received + underReview + remaining, 1);
  const percent = Math.round((received / total) * 100);

  return {
    documentCompletionPercent: Math.min(percent, 100),
    documentStats: { received, underReview, remaining },
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildBorrowerReadinessViewModel(
  input: ReadinessInput,
): BorrowerReadinessViewModel {
  const readiness = buildReadinessScore(input);
  const insights = buildInsights(input);
  const recommendations = buildRecommendations(input);
  const activity = buildActivityFeed(input);
  const { documentCompletionPercent, documentStats } =
    buildDocumentStats(input);

  return {
    readiness,
    insights,
    recommendations,
    activity,
    documentCompletionPercent,
    documentStats,
  };
}
