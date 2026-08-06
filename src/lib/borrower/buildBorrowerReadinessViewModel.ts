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

/** One row of the six-category weighted breakdown. Additive — existing
 *  consumers that only read score/band/summary/delta are unaffected. */
export type BorrowerReadinessComponent = {
  id:
    | "documentCompleteness"
    | "profileCompleteness"
    | "ownershipVerification"
    | "sbaFormsCompletion"
    | "financialPackage"
    | "blockerPenalty";
  label: string;
  /** 0-100, this category's own completion percentage. */
  scorePercent: number;
  /** 0-100, this category's weight in the overall score. */
  weightPercent: number;
  /** 0-100, scorePercent * weightPercent / 100 — this category's actual
   *  contribution to the overall score. */
  contributionPercent: number;
};

export type BorrowerReadinessScore = {
  score: number;
  band: BorrowerReadinessBand;
  summary: string;
  delta?: number;
  /** Additive: the six weighted sub-scores that produce `score`, previously
   *  computed internally and discarded. */
  components: BorrowerReadinessComponent[];
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

  /** Ownership verified? Retained for backward compatibility — used only
   *  when the richer `ownershipConditionsSatisfied`/`ownershipConditionsRequired`
   *  pair below is not supplied. */
  ownershipVerified: boolean;

  /** Ownership partial credit, e.g. 2 of 3 shared-evaluator conditions met
   *  (significant owner present, total ownership >= 80%, attestation on
   *  file). Optional/additive: when present, this replaces the binary
   *  `ownershipVerified` for scoring purposes so ownership can contribute
   *  partial credit instead of an all-or-nothing 0/1. */
  ownershipConditionsSatisfied?: number;
  ownershipConditionsRequired?: number;

  /** SBA forms status. `sbaFormsReceived` should count only forms whose
   *  status is "accepted" (Buddy/banker confirmed) — not merely uploaded. */
  sbaFormsReceived: number;
  sbaFormsRequired: number;
  /** Whether SBA forms apply to this deal at all. Defaults to true. When
   *  false, the category is treated as fully satisfied rather than scored
   *  0 — a deal that doesn't need SBA forms should never be prevented from
   *  reaching 100% because of them. */
  sbaFormsApplicable?: boolean;

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

/**
 * The six raw (0-1) sub-scores. Extracted from the former single
 * `computeReadinessScore` body so both the weighted total and the
 * borrower-facing breakdown panel derive from one calculation — no second
 * copy of this math exists anywhere else.
 */
function computeReadinessComponents(input: ReadinessInput) {
  const docScore =
    input.checklistRequired > 0
      ? input.checklistReceived / input.checklistRequired
      : 0;

  const profileScore = Math.min(input.profileCompleteness, 1);

  // Ownership: prefer partial-credit conditions from the shared borrower
  // completeness evaluator when supplied; fall back to the binary flag
  // otherwise (e.g. existing tests / callers that predate this field).
  const ownershipScore =
    input.ownershipConditionsRequired && input.ownershipConditionsRequired > 0
      ? Math.min(
          (input.ownershipConditionsSatisfied ?? 0) /
            input.ownershipConditionsRequired,
          1,
        )
      : input.ownershipVerified
        ? 1
        : 0;

  // SBA forms: not-applicable deals are fully satisfied, never zeroed —
  // a deal that doesn't require SBA forms shouldn't be blocked by them.
  const sbaApplicable = input.sbaFormsApplicable ?? true;
  const sbaScore = !sbaApplicable
    ? 1
    : input.sbaFormsRequired > 0
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

  return {
    docScore,
    profileScore,
    ownershipScore,
    sbaScore,
    financialScore,
    blockerScore,
  };
}

function computeReadinessScore(input: ReadinessInput): number {
  const c = computeReadinessComponents(input);

  const raw =
    c.docScore * READINESS_WEIGHTS.documentCompleteness +
    c.profileScore * READINESS_WEIGHTS.profileCompleteness +
    c.ownershipScore * READINESS_WEIGHTS.ownershipVerification +
    c.sbaScore * READINESS_WEIGHTS.sbaFormsCompletion +
    c.financialScore * READINESS_WEIGHTS.financialPackage +
    c.blockerScore * READINESS_WEIGHTS.blockerPenalty;

  // Convert to 0-100 and clamp
  return Math.min(Math.max(Math.round(raw * 100), 0), 100);
}

const COMPONENT_LABELS: Record<BorrowerReadinessComponent["id"], string> = {
  documentCompleteness: "Supporting Documentation",
  profileCompleteness: "Business Information",
  ownershipVerification: "Ownership verification",
  sbaFormsCompletion: "SBA forms",
  financialPackage: "Financial package",
  blockerPenalty: "No unresolved blockers",
};

function buildComponentBreakdown(
  input: ReadinessInput,
): BorrowerReadinessComponent[] {
  const c = computeReadinessComponents(input);
  const raw: Record<BorrowerReadinessComponent["id"], number> = {
    documentCompleteness: c.docScore,
    profileCompleteness: c.profileScore,
    ownershipVerification: c.ownershipScore,
    sbaFormsCompletion: c.sbaScore,
    financialPackage: c.financialScore,
    blockerPenalty: c.blockerScore,
  };

  return (Object.keys(READINESS_WEIGHTS) as Array<keyof typeof READINESS_WEIGHTS>).map(
    (id) => {
      const weightPercent = Math.round(READINESS_WEIGHTS[id] * 100);
      const scorePercent = Math.round(Math.min(Math.max(raw[id], 0), 1) * 100);
      return {
        id,
        label: COMPONENT_LABELS[id],
        scorePercent,
        weightPercent,
        contributionPercent: Math.round((scorePercent * weightPercent) / 100),
      };
    },
  );
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
  const components = buildComponentBreakdown(input);

  return { score, band, summary, delta, components };
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
