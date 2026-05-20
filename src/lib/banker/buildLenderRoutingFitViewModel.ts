/**
 * Lender Routing & Fit Intelligence — View Model Builder
 *
 * Deterministic, pure-function synthesizer that produces banker-facing
 * routing intelligence: routing state, lender/channel options, per-option
 * criteria matrix, missing routing inputs, and a next operational action.
 *
 * Spec: 15S / Spec 15 — Lender Routing & Fit Intelligence
 *
 * Rules:
 * - Pure function, no DB / network calls
 * - Operational routing readiness only — never approval, acceptance, or
 *   risk language
 * - Real state only — never invents lender criteria, deal attributes,
 *   "match scores", or "best lender" rankings
 * - When no lender criteria records are supplied, fall back to channel-level
 *   placeholders ONLY using attributes we actually know about the deal
 * - Deterministic ordering for testability
 * - Safe fallback for empty / minimal input
 */

import type { SubmissionOrchestrationViewModel } from "@/lib/banker/buildSubmissionOrchestrationViewModel";
import type { BorrowerOperationalContinuityViewModel } from "@/lib/banker/buildBorrowerOperationalContinuityViewModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LenderRoutingState =
  | "not_ready"
  | "gathering_fit_inputs"
  | "ready_for_fit_review"
  | "fit_review_in_progress"
  | "routing_options_available"
  | "routing_review_complete";

export type LenderFitCriterionStatus =
  | "match"
  | "possible_match"
  | "mismatch"
  | "missing_deal_data"
  | "missing_lender_data"
  | "not_applicable";

export type LenderFitCriterionId =
  | "loan_amount_range"
  | "geography"
  | "industry"
  | "use_of_proceeds"
  | "business_stage"
  | "collateral_profile"
  | "owner_occupied_real_estate"
  | "franchise_status"
  | "acquisition_vs_expansion"
  | "startup_vs_existing_business"
  | "required_sba_program"
  | "documentation_completeness"
  | "submission_package_readiness";

export type LenderFitCriterion = {
  id: LenderFitCriterionId | string;
  label: string;
  dealValue?: string;
  lenderValue?: string;
  status: LenderFitCriterionStatus;
  explanation: string;
};

export type LenderRoutingOptionStatus =
  | "strong_operational_fit"
  | "possible_fit"
  | "needs_more_information"
  | "not_currently_compatible"
  | "unavailable";

export type LenderRoutingMissingInputPriority = "required" | "helpful" | "optional";

export type LenderRoutingMissingInput = {
  id: string;
  label: string;
  reason: string;
  priority: LenderRoutingMissingInputPriority;
  href?: string;
};

export type LenderRoutingOption = {
  id: string;
  label: string;
  type: "lender" | "channel";
  status: LenderRoutingOptionStatus;
  summary: string;
  criteria: LenderFitCriterion[];
  missingInputs: LenderRoutingMissingInput[];
  recommendedActionLabel: string;
  href?: string;
};

export type LenderRoutingNextActionId =
  | "collect_routing_inputs"
  | "review_lender_fit"
  | "review_package_readiness"
  | "resolve_compatibility_gaps"
  | "prepare_lender_outreach"
  | "wait_for_submission_package"
  | "no_action_available";

export type LenderRoutingNextAction = {
  id: LenderRoutingNextActionId;
  label: string;
  rationale: string;
  urgency: "low" | "normal" | "high";
  href?: string;
};

export type LenderRoutingFitViewModel = {
  state: LenderRoutingState;
  headline: string;
  summary: string;
  routingReadinessLabel: string;
  options: LenderRoutingOption[];
  missingInputs: LenderRoutingMissingInput[];
  nextAction: LenderRoutingNextAction;
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type DealUseOfProceeds =
  | "acquisition"
  | "expansion"
  | "refinance"
  | "working_capital"
  | "real_estate"
  | "equipment"
  | "startup"
  | "other";

export type DealRoutingProfile = {
  loanAmount?: number | null;
  state?: string | null;
  city?: string | null;
  industry?: string | null;
  naicsCode?: string | null;
  useOfProceeds?: DealUseOfProceeds | null;
  businessStage?: "startup" | "existing" | null;
  collateralProfile?: string | null;
  ownerOccupiedRealEstate?: boolean | null;
  franchiseStatus?: "franchise" | "non_franchise" | "unknown" | null;
  acquisitionVsExpansion?: "acquisition" | "expansion" | "other" | null;
  requiredSbaProgram?: "7a" | "504" | "express" | null;
};

export type LenderCriteriaRecord = {
  id: string;
  name: string;
  type?: "lender" | "channel";
  loanAmountMin?: number | null;
  loanAmountMax?: number | null;
  acceptedStates?: string[] | null;
  acceptedIndustries?: string[] | null;
  excludedIndustries?: string[] | null;
  acceptedUseOfProceeds?: DealUseOfProceeds[] | null;
  acceptsStartups?: boolean | null;
  acceptsFranchise?: boolean | null;
  requiresOwnerOccupiedRealEstate?: boolean | null;
  acceptedPrograms?: ("7a" | "504" | "express")[] | null;
  href?: string | null;
  summary?: string | null;
};

export type PersistedRoutingReviewState = {
  reviewStartedAt?: string | null;
  reviewCompletedAt?: string | null;
};

export type LenderRoutingFitInput = {
  dealId: string;
  dealProfile?: DealRoutingProfile;
  lenderCriteria?: LenderCriteriaRecord[];
  orchestration?: SubmissionOrchestrationViewModel;
  continuity?: BorrowerOperationalContinuityViewModel;
  routingReview?: PersistedRoutingReviewState;
  prepareOutreachHref?: string | null;
  reviewFitHref?: string | null;
  collectInputsHref?: string | null;
  resolveCompatibilityHref?: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimOrNull(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatCurrency(amount: number | null | undefined): string | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatRange(
  min: number | null | undefined,
  max: number | null | undefined,
): string | null {
  const mn = formatCurrency(min ?? null);
  const mx = formatCurrency(max ?? null);
  if (mn && mx) return `${mn} – ${mx}`;
  if (mn) return `≥ ${mn}`;
  if (mx) return `≤ ${mx}`;
  return null;
}

function uniqByLabel(
  inputs: LenderRoutingMissingInput[],
): LenderRoutingMissingInput[] {
  const seen = new Set<string>();
  const out: LenderRoutingMissingInput[] = [];
  for (const item of inputs) {
    const key = item.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

const USE_LABEL: Record<DealUseOfProceeds, string> = {
  acquisition: "Business acquisition",
  expansion: "Expansion",
  refinance: "Refinance",
  working_capital: "Working capital",
  real_estate: "Real estate",
  equipment: "Equipment",
  startup: "Startup",
  other: "Other",
};

// ---------------------------------------------------------------------------
// Missing inputs detection
// ---------------------------------------------------------------------------

function detectMissingInputs(
  input: LenderRoutingFitInput,
): LenderRoutingMissingInput[] {
  const profile = input.dealProfile ?? {};
  const collectHref = trimOrNull(input.collectInputsHref) ?? undefined;
  const missing: LenderRoutingMissingInput[] = [];

  if (!profile.loanAmount || profile.loanAmount <= 0) {
    missing.push({
      id: "missing_loan_amount",
      label: "Loan amount",
      reason: "Loan amount is required to scope lender routing options.",
      priority: "required",
      ...(collectHref ? { href: collectHref } : {}),
    });
  }
  if (!trimOrNull(profile.state)) {
    missing.push({
      id: "missing_geography",
      label: "Business state",
      reason: "Lender footprint depends on the borrower's state.",
      priority: "required",
      ...(collectHref ? { href: collectHref } : {}),
    });
  }
  if (!profile.useOfProceeds) {
    missing.push({
      id: "missing_use_of_proceeds",
      label: "Use of proceeds",
      reason: "Use of proceeds shapes which lender channels are applicable.",
      priority: "required",
      ...(collectHref ? { href: collectHref } : {}),
    });
  }
  if (!trimOrNull(profile.industry) && !trimOrNull(profile.naicsCode)) {
    missing.push({
      id: "missing_industry",
      label: "Industry / NAICS",
      reason: "Lender appetite varies by industry; capture industry or NAICS.",
      priority: "required",
      ...(collectHref ? { href: collectHref } : {}),
    });
  }
  if (
    profile.franchiseStatus === undefined ||
    profile.franchiseStatus === null ||
    profile.franchiseStatus === "unknown"
  ) {
    missing.push({
      id: "missing_franchise_status",
      label: "Franchise status",
      reason: "Franchise status affects whether franchise-focused channels apply.",
      priority: "helpful",
      ...(collectHref ? { href: collectHref } : {}),
    });
  }
  if (
    (profile.useOfProceeds === "real_estate" ||
      profile.useOfProceeds === "equipment" ||
      profile.useOfProceeds === "acquisition") &&
    !trimOrNull(profile.collateralProfile)
  ) {
    missing.push({
      id: "missing_collateral",
      label: "Collateral profile",
      reason:
        "Collateral details help refine routing for asset-backed channels.",
      priority: "helpful",
      ...(collectHref ? { href: collectHref } : {}),
    });
  }
  if (profile.businessStage === undefined || profile.businessStage === null) {
    missing.push({
      id: "missing_business_stage",
      label: "Business stage",
      reason: "Startup vs. existing affects which lender channels apply.",
      priority: "helpful",
      ...(collectHref ? { href: collectHref } : {}),
    });
  }

  // Submission package readiness — from orchestration if available.
  const orchestration = input.orchestration;
  if (orchestration) {
    const blockingState =
      orchestration.state === "not_started" ||
      orchestration.state === "preparing_package" ||
      orchestration.state === "awaiting_clarifications";
    if (blockingState) {
      missing.push({
        id: "missing_submission_package",
        label: "Submission package readiness",
        reason:
          "Submission orchestration is not yet at package review. Routing should not push outreach until the package is ready.",
        priority: "required",
      });
    }
  }

  return uniqByLabel(missing);
}

// ---------------------------------------------------------------------------
// Channel-level fallback options (no real lender criteria supplied)
// ---------------------------------------------------------------------------

type ChannelTemplate = {
  id: string;
  label: string;
  /** Predicate: should this channel be surfaced given the known profile? */
  applies: (profile: DealRoutingProfile) => boolean;
  /** Short banker-safe summary */
  summary: string;
  /** Action label for banker */
  recommendedActionLabel: string;
};

const CHANNEL_TEMPLATES: ChannelTemplate[] = [
  {
    id: "channel_7a_generalist",
    label: "SBA 7(a) generalist channel",
    applies: () => true,
    summary:
      "General SBA 7(a) lenders that consider a broad range of business profiles.",
    recommendedActionLabel: "Review channel-level fit before outreach",
  },
  {
    id: "channel_acquisition",
    label: "SBA acquisition-focused channel",
    applies: (p) => p.useOfProceeds === "acquisition" || p.acquisitionVsExpansion === "acquisition",
    summary: "Lenders that focus on business acquisition transactions.",
    recommendedActionLabel: "Confirm acquisition details before outreach",
  },
  {
    id: "channel_cre",
    label: "SBA real-estate-focused channel",
    applies: (p) =>
      p.useOfProceeds === "real_estate" || p.ownerOccupiedRealEstate === true,
    summary:
      "Lenders that focus on owner-occupied real estate and SBA 504 / 7(a) CRE.",
    recommendedActionLabel: "Confirm owner-occupied real estate details",
  },
  {
    id: "channel_working_capital",
    label: "SBA working-capital channel",
    applies: (p) => p.useOfProceeds === "working_capital",
    summary:
      "Lenders that focus on working capital, lines of credit, and operating cash needs.",
    recommendedActionLabel: "Confirm working-capital use details",
  },
  {
    id: "channel_franchise",
    label: "SBA franchise-friendly channel",
    applies: (p) => p.franchiseStatus === "franchise",
    summary:
      "Lenders that focus on franchise and franchise-system borrowers.",
    recommendedActionLabel: "Confirm franchise system and SBA Franchise Directory match",
  },
  {
    id: "channel_startup",
    label: "SBA startup-friendly channel",
    applies: (p) =>
      p.businessStage === "startup" || p.useOfProceeds === "startup",
    summary:
      "Lenders that consider startup or early-stage borrowers operationally.",
    recommendedActionLabel: "Confirm startup readiness before outreach",
  },
];

function buildChannelCriteria(
  channelId: string,
  profile: DealRoutingProfile,
  orchestration?: SubmissionOrchestrationViewModel,
): LenderFitCriterion[] {
  const criteria: LenderFitCriterion[] = [];

  // 1. Use of proceeds
  const use = profile.useOfProceeds;
  criteria.push({
    id: "use_of_proceeds",
    label: "Use of proceeds",
    ...(use ? { dealValue: USE_LABEL[use] } : {}),
    status: use ? "match" : "missing_deal_data",
    explanation: use
      ? "Channel applicability uses deal's stated use of proceeds."
      : "Use of proceeds is required to scope channel applicability.",
  });

  // 2. Geography
  const state = trimOrNull(profile.state);
  criteria.push({
    id: "geography",
    label: "Geography",
    ...(state ? { dealValue: state } : {}),
    status: state ? "possible_match" : "missing_deal_data",
    explanation: state
      ? "Specific lender footprint is unknown at channel level — confirm before outreach."
      : "Borrower state is required for routing decisions.",
  });

  // 3. Loan amount
  const amount = formatCurrency(profile.loanAmount ?? null);
  criteria.push({
    id: "loan_amount_range",
    label: "Loan amount",
    ...(amount ? { dealValue: amount } : {}),
    status: amount ? "possible_match" : "missing_deal_data",
    explanation: amount
      ? "Channel-level fit cannot guarantee amount range — confirm with specific lenders."
      : "Loan amount is required to scope routing options.",
  });

  // 4. Industry
  const industry = trimOrNull(profile.industry) ?? trimOrNull(profile.naicsCode);
  criteria.push({
    id: "industry",
    label: "Industry",
    ...(industry ? { dealValue: industry } : {}),
    status: industry ? "possible_match" : "missing_deal_data",
    explanation: industry
      ? "Industry-level lender appetite varies — confirm with specific lenders."
      : "Industry / NAICS is needed to scope routing options.",
  });

  // 5. Franchise status when channel cares
  if (channelId === "channel_franchise") {
    const fr = profile.franchiseStatus;
    criteria.push({
      id: "franchise_status",
      label: "Franchise status",
      ...(fr && fr !== "unknown" ? { dealValue: fr === "franchise" ? "Franchise" : "Non-franchise" } : {}),
      status:
        fr === "franchise"
          ? "match"
          : fr === "non_franchise"
            ? "mismatch"
            : "missing_deal_data",
      explanation:
        fr === "franchise"
          ? "Franchise-friendly channel applies operationally."
          : fr === "non_franchise"
            ? "Channel focuses on franchises — operational mismatch."
            : "Franchise status is required for franchise-channel routing.",
    });
  }

  // 6. Owner-occupied real estate when CRE channel
  if (channelId === "channel_cre") {
    const own = profile.ownerOccupiedRealEstate;
    criteria.push({
      id: "owner_occupied_real_estate",
      label: "Owner-occupied real estate",
      ...(own !== null && own !== undefined
        ? { dealValue: own ? "Yes" : "No" }
        : {}),
      status:
        own === true
          ? "match"
          : own === false
            ? "mismatch"
            : "missing_deal_data",
      explanation:
        own === true
          ? "Owner-occupied profile fits SBA real-estate channels."
          : own === false
            ? "Non-owner-occupied is operationally outside this channel."
            : "Confirm owner-occupied real-estate status before routing.",
    });
  }

  // 7. Business stage when startup channel
  if (channelId === "channel_startup") {
    const stage = profile.businessStage;
    criteria.push({
      id: "business_stage",
      label: "Business stage",
      ...(stage ? { dealValue: stage === "startup" ? "Startup" : "Existing" } : {}),
      status:
        stage === "startup"
          ? "match"
          : stage === "existing"
            ? "mismatch"
            : "missing_deal_data",
      explanation:
        stage === "startup"
          ? "Startup channel applies operationally."
          : stage === "existing"
            ? "Existing business — startup channel is not applicable."
            : "Confirm business stage for startup-channel routing.",
    });
  }

  // 8. Submission package readiness — from orchestration if available
  if (orchestration) {
    const readyStates = ["ready_for_submission", "package_review"];
    const blockingStates = ["not_started", "preparing_package"];
    const status: LenderFitCriterionStatus = readyStates.includes(orchestration.state)
      ? "match"
      : blockingStates.includes(orchestration.state)
        ? "mismatch"
        : "possible_match";
    criteria.push({
      id: "submission_package_readiness",
      label: "Submission package readiness",
      dealValue: orchestration.headline,
      status,
      explanation:
        status === "match"
          ? "Submission package is at or near review-readiness."
          : status === "mismatch"
            ? "Submission package is not yet ready for outreach."
            : "Submission package status should be confirmed before outreach.",
    });
  }

  return criteria;
}

function buildChannelOptions(
  input: LenderRoutingFitInput,
): LenderRoutingOption[] {
  const profile = input.dealProfile ?? {};
  const collectHref = trimOrNull(input.collectInputsHref) ?? undefined;

  return CHANNEL_TEMPLATES.filter((tpl) => tpl.applies(profile)).map((tpl) => {
    const criteria = buildChannelCriteria(tpl.id, profile, input.orchestration);
    const missingDeal = criteria.filter((c) => c.status === "missing_deal_data").length;
    const mismatches = criteria.filter((c) => c.status === "mismatch").length;
    const matches = criteria.filter((c) => c.status === "match").length;

    let status: LenderRoutingOptionStatus;
    if (mismatches > 0) status = "not_currently_compatible";
    else if (missingDeal >= 2) status = "needs_more_information";
    else if (matches >= 2 && missingDeal === 0) status = "possible_fit";
    else if (matches >= 1) status = "possible_fit";
    else status = "needs_more_information";

    const missingInputs: LenderRoutingMissingInput[] = criteria
      .filter((c) => c.status === "missing_deal_data")
      .map((c) => ({
        id: `${tpl.id}_missing_${c.id}`,
        label: c.label,
        reason: c.explanation,
        priority: "required" as const,
        ...(collectHref ? { href: collectHref } : {}),
      }));

    return {
      id: tpl.id,
      label: tpl.label,
      type: "channel" as const,
      status,
      summary: tpl.summary,
      criteria,
      missingInputs,
      recommendedActionLabel: tpl.recommendedActionLabel,
    };
  });
}

// ---------------------------------------------------------------------------
// Lender-specific options (when real lender criteria are supplied)
// ---------------------------------------------------------------------------

function evaluateLenderOption(
  lender: LenderCriteriaRecord,
  profile: DealRoutingProfile,
  orchestration?: SubmissionOrchestrationViewModel,
): LenderRoutingOption {
  const criteria: LenderFitCriterion[] = [];

  // Loan amount range
  const range = formatRange(lender.loanAmountMin, lender.loanAmountMax);
  const dealAmount = profile.loanAmount;
  let amountStatus: LenderFitCriterionStatus = "not_applicable";
  if (lender.loanAmountMin == null && lender.loanAmountMax == null) {
    amountStatus = "missing_lender_data";
  } else if (typeof dealAmount !== "number" || dealAmount <= 0) {
    amountStatus = "missing_deal_data";
  } else {
    const minOk = lender.loanAmountMin == null || dealAmount >= lender.loanAmountMin;
    const maxOk = lender.loanAmountMax == null || dealAmount <= lender.loanAmountMax;
    amountStatus = minOk && maxOk ? "match" : "mismatch";
  }
  criteria.push({
    id: "loan_amount_range",
    label: "Loan amount range",
    ...(formatCurrency(dealAmount ?? null) ? { dealValue: formatCurrency(dealAmount ?? null)! } : {}),
    ...(range ? { lenderValue: range } : {}),
    status: amountStatus,
    explanation:
      amountStatus === "match"
        ? "Loan amount sits inside the lender's stated operational range."
        : amountStatus === "mismatch"
          ? "Loan amount sits outside the lender's stated range."
          : amountStatus === "missing_lender_data"
            ? "Lender has not published an operational loan-amount range."
            : "Deal does not yet have a loan amount on file.",
  });

  // Geography
  const state = trimOrNull(profile.state);
  const states = lender.acceptedStates ?? null;
  let geoStatus: LenderFitCriterionStatus = "not_applicable";
  if (!state) geoStatus = "missing_deal_data";
  else if (!states || states.length === 0) geoStatus = "missing_lender_data";
  else geoStatus = states.includes(state) ? "match" : "mismatch";
  criteria.push({
    id: "geography",
    label: "Geography",
    ...(state ? { dealValue: state } : {}),
    ...(states && states.length > 0 ? { lenderValue: states.join(", ") } : {}),
    status: geoStatus,
    explanation:
      geoStatus === "match"
        ? "Lender accepts borrowers in this state."
        : geoStatus === "mismatch"
          ? "Lender does not currently accept this state."
          : geoStatus === "missing_lender_data"
            ? "Lender footprint not published."
            : "Borrower state is not on file.",
  });

  // Use of proceeds
  const use = profile.useOfProceeds;
  const accepted = lender.acceptedUseOfProceeds ?? null;
  let useStatus: LenderFitCriterionStatus = "not_applicable";
  if (!use) useStatus = "missing_deal_data";
  else if (!accepted || accepted.length === 0) useStatus = "missing_lender_data";
  else useStatus = accepted.includes(use) ? "match" : "mismatch";
  criteria.push({
    id: "use_of_proceeds",
    label: "Use of proceeds",
    ...(use ? { dealValue: USE_LABEL[use] } : {}),
    ...(accepted && accepted.length > 0
      ? { lenderValue: accepted.map((u) => USE_LABEL[u]).join(", ") }
      : {}),
    status: useStatus,
    explanation:
      useStatus === "match"
        ? "Use of proceeds matches the lender's operational focus."
        : useStatus === "mismatch"
          ? "Use of proceeds is operationally outside this lender."
          : useStatus === "missing_lender_data"
            ? "Lender has not published a use-of-proceeds list."
            : "Deal's use of proceeds is not on file.",
  });

  // Industry
  const industry = trimOrNull(profile.industry) ?? trimOrNull(profile.naicsCode);
  const acceptedInd = lender.acceptedIndustries ?? null;
  const excludedInd = lender.excludedIndustries ?? null;
  let indStatus: LenderFitCriterionStatus = "not_applicable";
  if (!industry) indStatus = "missing_deal_data";
  else if (excludedInd && excludedInd.includes(industry)) indStatus = "mismatch";
  else if (acceptedInd && acceptedInd.length > 0)
    indStatus = acceptedInd.includes(industry) ? "match" : "possible_match";
  else indStatus = "missing_lender_data";
  criteria.push({
    id: "industry",
    label: "Industry",
    ...(industry ? { dealValue: industry } : {}),
    ...(acceptedInd && acceptedInd.length > 0
      ? { lenderValue: acceptedInd.join(", ") }
      : {}),
    status: indStatus,
    explanation:
      indStatus === "match"
        ? "Industry sits in the lender's accepted operational list."
        : indStatus === "mismatch"
          ? "Industry is operationally excluded by this lender."
          : indStatus === "possible_match"
            ? "Industry is not explicitly listed; confirm with the lender."
            : indStatus === "missing_lender_data"
              ? "Lender has not published industry preferences."
              : "Deal industry is not on file.",
  });

  // Startup acceptance
  const stage = profile.businessStage;
  let startupStatus: LenderFitCriterionStatus = "not_applicable";
  if (stage === "startup") {
    if (lender.acceptsStartups === true) startupStatus = "match";
    else if (lender.acceptsStartups === false) startupStatus = "mismatch";
    else startupStatus = "missing_lender_data";
  } else if (stage === "existing") {
    startupStatus = "not_applicable";
  } else {
    startupStatus = "missing_deal_data";
  }
  if (startupStatus !== "not_applicable") {
    criteria.push({
      id: "startup_vs_existing_business",
      label: "Startup acceptance",
      ...(stage ? { dealValue: stage === "startup" ? "Startup" : "Existing" } : {}),
      ...(lender.acceptsStartups !== undefined && lender.acceptsStartups !== null
        ? { lenderValue: lender.acceptsStartups ? "Accepts startups" : "Does not accept startups" }
        : {}),
      status: startupStatus,
      explanation:
        startupStatus === "match"
          ? "Lender's stated stance accepts startup borrowers."
          : startupStatus === "mismatch"
            ? "Lender's stated stance does not accept startups."
            : startupStatus === "missing_lender_data"
              ? "Lender has not published a startup stance."
              : "Business stage is not on file.",
    });
  }

  // Franchise acceptance
  const fr = profile.franchiseStatus;
  if (fr === "franchise") {
    let frStatus: LenderFitCriterionStatus;
    if (lender.acceptsFranchise === true) frStatus = "match";
    else if (lender.acceptsFranchise === false) frStatus = "mismatch";
    else frStatus = "missing_lender_data";
    criteria.push({
      id: "franchise_status",
      label: "Franchise acceptance",
      dealValue: "Franchise",
      ...(lender.acceptsFranchise !== undefined && lender.acceptsFranchise !== null
        ? { lenderValue: lender.acceptsFranchise ? "Accepts franchise" : "Does not accept franchise" }
        : {}),
      status: frStatus,
      explanation:
        frStatus === "match"
          ? "Lender accepts franchise borrowers."
          : frStatus === "mismatch"
            ? "Lender does not accept franchise borrowers."
            : "Lender has not published a franchise stance.",
    });
  }

  // Owner-occupied real estate when required by lender
  if (lender.requiresOwnerOccupiedRealEstate === true) {
    const own = profile.ownerOccupiedRealEstate;
    const oorStatus: LenderFitCriterionStatus =
      own === true ? "match" : own === false ? "mismatch" : "missing_deal_data";
    criteria.push({
      id: "owner_occupied_real_estate",
      label: "Owner-occupied real estate",
      ...(own !== null && own !== undefined
        ? { dealValue: own ? "Yes" : "No" }
        : {}),
      lenderValue: "Required",
      status: oorStatus,
      explanation:
        oorStatus === "match"
          ? "Owner-occupied profile satisfies this lender's requirement."
          : oorStatus === "mismatch"
            ? "Non-owner-occupied does not satisfy this lender's requirement."
            : "Owner-occupied status is not on file.",
    });
  }

  // Program preference
  const program = profile.requiredSbaProgram;
  const acceptedPrograms = lender.acceptedPrograms ?? null;
  if (program && acceptedPrograms) {
    const progStatus: LenderFitCriterionStatus = acceptedPrograms.includes(program)
      ? "match"
      : "mismatch";
    criteria.push({
      id: "required_sba_program",
      label: "SBA program",
      dealValue: program.toUpperCase(),
      lenderValue: acceptedPrograms.map((p) => p.toUpperCase()).join(", "),
      status: progStatus,
      explanation:
        progStatus === "match"
          ? "SBA program is in the lender's operational list."
          : "SBA program is operationally outside the lender's list.",
    });
  }

  // Submission package readiness
  if (orchestration) {
    const readyStates = ["ready_for_submission", "package_review"];
    const blockingStates = ["not_started", "preparing_package", "awaiting_clarifications"];
    const status: LenderFitCriterionStatus = readyStates.includes(orchestration.state)
      ? "match"
      : blockingStates.includes(orchestration.state)
        ? "mismatch"
        : "possible_match";
    criteria.push({
      id: "submission_package_readiness",
      label: "Submission package readiness",
      dealValue: orchestration.headline,
      status,
      explanation:
        status === "match"
          ? "Submission package is at or near review-readiness."
          : status === "mismatch"
            ? "Submission package is not yet ready for outreach."
            : "Confirm submission package status before outreach.",
    });
  }

  // Derive option status
  const mismatchCount = criteria.filter((c) => c.status === "mismatch").length;
  const matchCount = criteria.filter((c) => c.status === "match").length;
  const missingDeal = criteria.filter((c) => c.status === "missing_deal_data").length;
  const missingLender = criteria.filter((c) => c.status === "missing_lender_data").length;

  let status: LenderRoutingOptionStatus;
  if (mismatchCount > 0) status = "not_currently_compatible";
  else if (matchCount >= 3 && missingDeal === 0) status = "strong_operational_fit";
  else if (matchCount >= 1 && missingDeal <= 1) status = "possible_fit";
  else if (missingDeal + missingLender >= 3) status = "needs_more_information";
  else if (matchCount === 0 && missingLender > 0) status = "unavailable";
  else status = "needs_more_information";

  const missingInputs: LenderRoutingMissingInput[] = criteria
    .filter((c) => c.status === "missing_deal_data")
    .map((c) => ({
      id: `${lender.id}_missing_${c.id}`,
      label: c.label,
      reason: c.explanation,
      priority: "required" as const,
    }));

  const option: LenderRoutingOption = {
    id: `lender_${lender.id}`,
    label: lender.name,
    type: lender.type ?? "lender",
    status,
    summary:
      trimOrNull(lender.summary ?? null) ??
      "Operational compatibility view; not a credit or approval indicator.",
    criteria,
    missingInputs,
    recommendedActionLabel:
      status === "strong_operational_fit"
        ? "Plan outreach checklist before lender contact"
        : status === "possible_fit"
          ? "Confirm details before lender contact"
          : status === "not_currently_compatible"
            ? "Resolve compatibility gaps or consider another option"
            : "Collect missing inputs before lender contact",
  };
  const href = trimOrNull(lender.href ?? null) ?? undefined;
  if (href) option.href = href;
  return option;
}

function buildLenderOptions(
  input: LenderRoutingFitInput,
): LenderRoutingOption[] {
  const profile = input.dealProfile ?? {};
  const records = input.lenderCriteria ?? [];
  return records.map((rec) => evaluateLenderOption(rec, profile, input.orchestration));
}

// ---------------------------------------------------------------------------
// Options assembly + ordering
// ---------------------------------------------------------------------------

const OPTION_STATUS_RANK: Record<LenderRoutingOptionStatus, number> = {
  strong_operational_fit: 0,
  possible_fit: 1,
  needs_more_information: 2,
  unavailable: 3,
  not_currently_compatible: 4,
};

function buildOptions(input: LenderRoutingFitInput): LenderRoutingOption[] {
  const records = input.lenderCriteria ?? [];
  const options =
    records.length > 0 ? buildLenderOptions(input) : buildChannelOptions(input);

  // Deterministic sort: status rank, then label
  return [...options].sort((a, b) => {
    const ra = OPTION_STATUS_RANK[a.status];
    const rb = OPTION_STATUS_RANK[b.status];
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label);
  });
}

// ---------------------------------------------------------------------------
// State derivation
// ---------------------------------------------------------------------------

function deriveState(
  input: LenderRoutingFitInput,
  options: LenderRoutingOption[],
  missingInputs: LenderRoutingMissingInput[],
): LenderRoutingState {
  if (trimOrNull(input.routingReview?.reviewCompletedAt ?? null)) {
    return "routing_review_complete";
  }
  if (trimOrNull(input.routingReview?.reviewStartedAt ?? null)) {
    return "fit_review_in_progress";
  }

  const profile = input.dealProfile ?? {};
  const hasAnyProfileSignal =
    !!profile.loanAmount ||
    !!trimOrNull(profile.state) ||
    !!profile.useOfProceeds ||
    !!trimOrNull(profile.industry ?? null) ||
    !!trimOrNull(profile.naicsCode ?? null);

  if (!hasAnyProfileSignal && options.length === 0) return "not_ready";

  const requiredMissing = missingInputs.filter((i) => i.priority === "required").length;
  if (requiredMissing >= 2) return "gathering_fit_inputs";

  const hasUsableOption = options.some(
    (o) =>
      o.status === "strong_operational_fit" || o.status === "possible_fit",
  );

  if (hasUsableOption) return "routing_options_available";

  if (!hasAnyProfileSignal) return "not_ready";

  return "ready_for_fit_review";
}

// ---------------------------------------------------------------------------
// Headlines / readiness label / summary
// ---------------------------------------------------------------------------

const STATE_HEADLINES: Record<LenderRoutingState, string> = {
  not_ready: "Routing intelligence isn't ready yet.",
  gathering_fit_inputs:
    "Routing review is waiting on the inputs that scope lender options.",
  ready_for_fit_review: "Deal attributes are sufficient to start a routing review.",
  fit_review_in_progress: "A routing review is in progress.",
  routing_options_available: "Operational routing options are available.",
  routing_review_complete: "Routing review marked complete.",
};

const STATE_READINESS_LABELS: Record<LenderRoutingState, string> = {
  not_ready: "Not ready for routing",
  gathering_fit_inputs: "Gathering routing inputs",
  ready_for_fit_review: "Ready for routing review",
  fit_review_in_progress: "Routing review in progress",
  routing_options_available: "Routing options available",
  routing_review_complete: "Routing review complete",
};

function buildSummary(
  input: LenderRoutingFitInput,
  state: LenderRoutingState,
  options: LenderRoutingOption[],
  missingInputs: LenderRoutingMissingInput[],
): string {
  const hasLenderRecords = (input.lenderCriteria ?? []).length > 0;
  const requiredMissing = missingInputs.filter((m) => m.priority === "required");

  switch (state) {
    case "not_ready":
      return hasLenderRecords
        ? "Deal attributes have not been provided yet; routing cannot proceed."
        : "Deal attributes have not been provided yet, and specific lender criteria are unavailable.";
    case "gathering_fit_inputs": {
      const labels = requiredMissing.slice(0, 3).map((m) => m.label.toLowerCase());
      const list =
        labels.length === 0
          ? ""
          : labels.length === 1
            ? labels[0]
            : labels.length === 2
              ? `${labels[0]} and ${labels[1]}`
              : `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
      return list
        ? `Routing review is waiting on ${list}.`
        : "Routing review is waiting on additional inputs.";
    }
    case "ready_for_fit_review":
      return hasLenderRecords
        ? "Deal attributes are sufficient to start an operational fit review against the lender list."
        : "Specific lender matching is unavailable until lender criteria are configured. Channel-level review can begin.";
    case "fit_review_in_progress":
      return "A routing review is currently in progress.";
    case "routing_options_available": {
      const usable = options.filter(
        (o) =>
          o.status === "strong_operational_fit" || o.status === "possible_fit",
      );
      const channelOnly = options.every((o) => o.type === "channel");
      return channelOnly
        ? `${usable.length} channel option${usable.length === 1 ? "" : "s"} appear operationally compatible based on current attributes.`
        : `${usable.length} routing option${usable.length === 1 ? "" : "s"} appear operationally compatible based on current attributes.`;
    }
    case "routing_review_complete":
      return "Routing review has been marked complete.";
  }
}

// ---------------------------------------------------------------------------
// Next action derivation
// ---------------------------------------------------------------------------

function deriveNextAction(
  input: LenderRoutingFitInput,
  state: LenderRoutingState,
  options: LenderRoutingOption[],
  missingInputs: LenderRoutingMissingInput[],
): LenderRoutingNextAction {
  const outreachHref = trimOrNull(input.prepareOutreachHref) ?? undefined;
  const reviewHref = trimOrNull(input.reviewFitHref) ?? undefined;
  const collectHref = trimOrNull(input.collectInputsHref) ?? undefined;
  const resolveHref = trimOrNull(input.resolveCompatibilityHref) ?? undefined;

  if (state === "routing_review_complete") {
    return {
      id: "no_action_available",
      label: "No action available",
      rationale: "Routing review has been marked complete.",
      urgency: "low",
    };
  }

  // Submission package readiness blocks outreach.
  const packageNotReady =
    input.orchestration &&
    (input.orchestration.state === "not_started" ||
      input.orchestration.state === "preparing_package" ||
      input.orchestration.state === "awaiting_clarifications");
  if (packageNotReady) {
    return {
      id: "wait_for_submission_package",
      label: "Wait for submission package",
      rationale:
        "Submission orchestration is not yet at review-readiness. Outreach should wait until the package is ready.",
      urgency: "normal",
    };
  }

  if (state === "routing_options_available") {
    const action: LenderRoutingNextAction = {
      id: "prepare_lender_outreach",
      label: "Prepare lender outreach",
      rationale: `${options.filter((o) => o.status === "possible_fit" || o.status === "strong_operational_fit").length} option(s) look operationally compatible.`,
      urgency: "high",
    };
    if (outreachHref) action.href = outreachHref;
    return action;
  }

  if (state === "fit_review_in_progress") {
    const action: LenderRoutingNextAction = {
      id: "review_lender_fit",
      label: "Continue routing review",
      rationale: "A routing review is already in progress.",
      urgency: "normal",
    };
    if (reviewHref) action.href = reviewHref;
    return action;
  }

  if (state === "gathering_fit_inputs") {
    const action: LenderRoutingNextAction = {
      id: "collect_routing_inputs",
      label: "Collect routing inputs",
      rationale: `${missingInputs.filter((m) => m.priority === "required").length} required routing input(s) outstanding.`,
      urgency: "high",
    };
    if (collectHref) action.href = collectHref;
    return action;
  }

  // Compatibility gaps
  const compatibilityGaps = options.some(
    (o) => o.status === "not_currently_compatible",
  );
  if (compatibilityGaps) {
    const action: LenderRoutingNextAction = {
      id: "resolve_compatibility_gaps",
      label: "Resolve compatibility gaps",
      rationale: "One or more options show operational mismatches that need review.",
      urgency: "normal",
    };
    if (resolveHref) action.href = resolveHref;
    return action;
  }

  if (state === "ready_for_fit_review") {
    const action: LenderRoutingNextAction = {
      id: "review_lender_fit",
      label: "Start routing review",
      rationale: "Inputs are sufficient to start an operational fit review.",
      urgency: "normal",
    };
    if (reviewHref) action.href = reviewHref;
    return action;
  }

  return {
    id: "no_action_available",
    label: "No action available",
    rationale: "Routing intelligence is not actionable yet.",
    urgency: "low",
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildLenderRoutingFitViewModel(
  input: LenderRoutingFitInput,
): LenderRoutingFitViewModel {
  const missingInputs = detectMissingInputs(input);
  const options = buildOptions(input);
  const state = deriveState(input, options, missingInputs);
  const nextAction = deriveNextAction(input, state, options, missingInputs);

  return {
    state,
    headline: STATE_HEADLINES[state],
    summary: buildSummary(input, state, options, missingInputs),
    routingReadinessLabel: STATE_READINESS_LABELS[state],
    options,
    missingInputs,
    nextAction,
  };
}

// ---------------------------------------------------------------------------
// Public labels (for UI + tests)
// ---------------------------------------------------------------------------

export const LENDER_ROUTING_STATE_LABELS = STATE_READINESS_LABELS;

export const LENDER_ROUTING_OPTION_STATUS_LABELS: Record<
  LenderRoutingOptionStatus,
  string
> = {
  strong_operational_fit: "Strong operational fit",
  possible_fit: "Possible fit",
  needs_more_information: "Needs more information",
  not_currently_compatible: "Not currently compatible",
  unavailable: "Unavailable",
};

export const LENDER_FIT_CRITERION_STATUS_LABELS: Record<
  LenderFitCriterionStatus,
  string
> = {
  match: "Match",
  possible_match: "Possible match",
  mismatch: "Mismatch",
  missing_deal_data: "Missing deal data",
  missing_lender_data: "Missing lender data",
  not_applicable: "Not applicable",
};
