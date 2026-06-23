/**
 * Borrower Trust, Review, and Confirmation Layer — View Model Builder
 *
 * Deterministic, pure-function synthesizer that produces a borrower-safe
 * review/confirmation experience prior to lender package handoff.
 *
 * Spec: 15M / Spec 9 — Borrower Trust, Review, and Confirmation Layer
 *
 * Rules:
 * - Pure function, no DB or network calls
 * - Borrower-safe plain English only (no internal enums, no underwriting jargon)
 * - Real state only — never invents borrower data, confirmations, or timestamps
 * - Without confirmation persistence, statuses default to needs_confirmation
 *   / missing / not_applicable (never confirmed)
 * - Deterministic ordering for testability
 * - No approval / funding / lending decision language
 */

import type { BorrowerJourneyViewModel } from "@/lib/borrower/buildBorrowerJourneyViewModel";
import type { BorrowerReadinessViewModel } from "@/lib/borrower/buildBorrowerReadinessViewModel";
import type { BorrowerGuidanceViewModel } from "@/lib/borrower/buildBorrowerGuidanceViewModel";
import type { BorrowerCommunicationViewModel } from "@/lib/borrower/buildBorrowerCommunicationViewModel";
import type { BorrowerDocumentExperienceViewModel } from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";
import type { BorrowerMobileCommandViewModel } from "@/lib/borrower/buildBorrowerMobileCommandViewModel";
import type { BorrowerSubmissionReadinessViewModel } from "@/lib/borrower/buildBorrowerSubmissionReadinessViewModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BorrowerTrustReviewState =
  | "not_ready_to_review"
  | "ready_to_review"
  | "confirmations_needed"
  | "reviewed"
  | "waiting_on_updates";

export type BorrowerReviewFieldStatus = "available" | "missing" | "unavailable";

export type BorrowerReviewField = {
  id: string;
  label: string;
  value?: string;
  status: BorrowerReviewFieldStatus;
  href?: string;
};

export type BorrowerReviewGroupId =
  | "business_information"
  | "ownership_information"
  | "contact_information"
  | "financing_context"
  | "uploaded_package";

export type BorrowerReviewGroup = {
  id: BorrowerReviewGroupId;
  label: string;
  fields: BorrowerReviewField[];
};

export type BorrowerConfirmationStatus =
  | "confirmed"
  | "needs_confirmation"
  | "missing"
  | "not_applicable";

export type BorrowerConfirmationItem = {
  id: string;
  label: string;
  description: string;
  status: BorrowerConfirmationStatus;
  href?: string;
};

export type BorrowerPackageReviewSummary = {
  requiredReceived: number;
  requiredRemaining: number;
  needsAttention: number;
  categoriesReceived: string[];
  submissionReadinessLabel: string;
};

export type BorrowerTrustReviewViewModel = {
  state: BorrowerTrustReviewState;
  headline: string;
  summary: string;
  reviewGroups: BorrowerReviewGroup[];
  confirmationItems: BorrowerConfirmationItem[];
  packageSummary: BorrowerPackageReviewSummary;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  caveatMessage: string;
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type BorrowerTrustReviewOwner = {
  id?: string | null;
  name?: string | null;
  ownershipPercent?: number | null;
};

export type BorrowerTrustReviewProfile = {
  /** Legal business name on file (deal/business name) */
  businessLegalName?: string | null;
  /** Doing-business-as name, if available */
  dbaName?: string | null;
  /** Business address (single-line, borrower-safe) */
  businessAddress?: string | null;
  /** Primary contact email */
  primaryContactEmail?: string | null;
  /** Primary contact phone */
  primaryContactPhone?: string | null;
  /** Primary contact name, if different from borrower name */
  primaryContactName?: string | null;
  /** Requested loan amount in USD */
  requestedLoanAmount?: number | null;
  /** Use of proceeds (short borrower-safe summary) */
  useOfProceeds?: string | null;
  /** Ownership entries on file */
  owners?: BorrowerTrustReviewOwner[] | null;
  /** Whether borrower confirmation persistence exists. Defaults to false. */
  confirmationPersistenceEnabled?: boolean;
  /** Optional href the borrower can use to update business details */
  updateBusinessHref?: string | null;
  /** Optional href to update ownership information */
  updateOwnershipHref?: string | null;
  /** Optional href to update contact information */
  updateContactHref?: string | null;
  /** Optional href to update financing context */
  updateFinancingHref?: string | null;
};

export type BorrowerTrustReviewInput = {
  token: string;
  borrowerName?: string | null;
  journey: BorrowerJourneyViewModel;
  readiness?: BorrowerReadinessViewModel;
  guidance: BorrowerGuidanceViewModel;
  communication: BorrowerCommunicationViewModel;
  documents: BorrowerDocumentExperienceViewModel;
  mobileCommand?: BorrowerMobileCommandViewModel;
  submission: BorrowerSubmissionReadinessViewModel;
  profile?: BorrowerTrustReviewProfile;
};

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function trimOrNull(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildField(params: {
  id: string;
  label: string;
  value?: string | null;
  href?: string | null;
}): BorrowerReviewField {
  const value = trimOrNull(params.value);
  const href = trimOrNull(params.href) ?? undefined;
  if (value) {
    return {
      id: params.id,
      label: params.label,
      value,
      status: "available",
      ...(href ? { href } : {}),
    };
  }
  return {
    id: params.id,
    label: params.label,
    status: "missing",
    ...(href ? { href } : {}),
  };
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

function formatOwnerLine(owner: BorrowerTrustReviewOwner): string | null {
  const name = trimOrNull(owner.name);
  if (!name) return null;
  const pct = owner.ownershipPercent;
  if (typeof pct === "number" && Number.isFinite(pct) && pct > 0 && pct <= 100) {
    const rounded = Math.round(pct * 10) / 10;
    return `${name} — ${rounded}%`;
  }
  return name;
}

// ---------------------------------------------------------------------------
// Review groups
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  financial: "Financial documents",
  forms: "SBA forms",
  identity: "Identity documents",
  ownership: "Ownership documents",
  business_documents: "Business documents",
  supporting: "Supporting documents",
};

function buildBusinessInfoGroup(input: BorrowerTrustReviewInput): BorrowerReviewGroup {
  const profile = input.profile ?? {};
  const updateHref = profile.updateBusinessHref ?? undefined;
  const fields: BorrowerReviewField[] = [
    buildField({
      id: "business_legal_name",
      label: "Business legal name",
      value: profile.businessLegalName ?? null,
      href: updateHref,
    }),
    buildField({
      id: "business_dba",
      label: "DBA name",
      value: profile.dbaName,
      href: updateHref,
    }),
    buildField({
      id: "business_address",
      label: "Business address",
      value: profile.businessAddress,
      href: updateHref,
    }),
  ];
  return {
    id: "business_information",
    label: "Business information",
    fields,
  };
}

function buildOwnershipGroup(input: BorrowerTrustReviewInput): BorrowerReviewGroup {
  const profile = input.profile ?? {};
  const updateHref = profile.updateOwnershipHref ?? undefined;
  const fields: BorrowerReviewField[] = [];
  const owners = Array.isArray(profile.owners) ? profile.owners : [];
  const visibleOwners = owners
    .map((owner, idx) => ({ owner, idx, line: formatOwnerLine(owner) }))
    .filter((entry) => entry.line !== null);

  if (visibleOwners.length === 0) {
    fields.push(
      buildField({
        id: "ownership_primary",
        label: "Owners on file",
        value: null,
        href: updateHref,
      }),
    );
  } else {
    for (const entry of visibleOwners) {
      fields.push(
        buildField({
          id: `ownership_${entry.owner.id ? entry.owner.id : `idx_${entry.idx}`}`,
          label: "Owner on file",
          value: entry.line,
          href: updateHref,
        }),
      );
    }
  }
  return {
    id: "ownership_information",
    label: "Ownership information",
    fields,
  };
}

function buildContactGroup(input: BorrowerTrustReviewInput): BorrowerReviewGroup {
  const profile = input.profile ?? {};
  const updateHref = profile.updateContactHref ?? undefined;
  const fields: BorrowerReviewField[] = [
    buildField({
      id: "contact_name",
      label: "Primary contact name",
      value: profile.primaryContactName ?? input.borrowerName ?? null,
      href: updateHref,
    }),
    buildField({
      id: "contact_email",
      label: "Primary contact email",
      value: profile.primaryContactEmail,
      href: updateHref,
    }),
    buildField({
      id: "contact_phone",
      label: "Primary contact phone",
      value: profile.primaryContactPhone,
      href: updateHref,
    }),
  ];
  return {
    id: "contact_information",
    label: "Contact information",
    fields,
  };
}

function buildFinancingGroup(input: BorrowerTrustReviewInput): BorrowerReviewGroup {
  const profile = input.profile ?? {};
  const updateHref = profile.updateFinancingHref ?? undefined;
  const fields: BorrowerReviewField[] = [
    buildField({
      id: "financing_amount",
      label: "Requested loan amount",
      value: formatCurrency(profile.requestedLoanAmount ?? null),
      href: updateHref,
    }),
    buildField({
      id: "financing_use",
      label: "Use of proceeds",
      value: profile.useOfProceeds,
      href: updateHref,
    }),
  ];
  return {
    id: "financing_context",
    label: "Requested financing context",
    fields,
  };
}

function buildUploadedPackageGroup(
  input: BorrowerTrustReviewInput,
): BorrowerReviewGroup {
  const categories = collectCategoriesReceived(input);
  const fields: BorrowerReviewField[] = [];
  if (categories.length === 0) {
    fields.push({
      id: "uploaded_package_summary",
      label: "Received document categories",
      status: "missing",
    });
  } else {
    for (const category of categories) {
      fields.push({
        id: `uploaded_${category.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        label: "Received documents",
        value: category,
        status: "available",
      });
    }
  }
  return {
    id: "uploaded_package",
    label: "Uploaded package",
    fields,
  };
}

const GROUP_ORDER: BorrowerReviewGroupId[] = [
  "business_information",
  "ownership_information",
  "contact_information",
  "financing_context",
  "uploaded_package",
];

function buildReviewGroups(input: BorrowerTrustReviewInput): BorrowerReviewGroup[] {
  const groups: Record<BorrowerReviewGroupId, BorrowerReviewGroup> = {
    business_information: buildBusinessInfoGroup(input),
    ownership_information: buildOwnershipGroup(input),
    contact_information: buildContactGroup(input),
    financing_context: buildFinancingGroup(input),
    uploaded_package: buildUploadedPackageGroup(input),
  };
  return GROUP_ORDER.map((id) => groups[id]);
}

// ---------------------------------------------------------------------------
// Package summary
// ---------------------------------------------------------------------------

function collectCategoriesReceived(input: BorrowerTrustReviewInput): string[] {
  const seen = new Set<string>();
  for (const item of input.submission.packageItems) {
    const label = CATEGORY_LABELS[item.category];
    if (label) seen.add(label);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

function buildPackageSummary(
  input: BorrowerTrustReviewInput,
): BorrowerPackageReviewSummary {
  const pkg = input.documents.packageSummary;
  return {
    requiredReceived: pkg.requiredReceived,
    requiredRemaining: pkg.requiredRemaining,
    needsAttention: pkg.needsAttention,
    categoriesReceived: collectCategoriesReceived(input),
    submissionReadinessLabel: input.submission.bandLabel,
  };
}

// ---------------------------------------------------------------------------
// Confirmation items
// ---------------------------------------------------------------------------

type ConfirmationPlan = {
  id: string;
  label: string;
  description: string;
  /** When fields are available; otherwise overridden to missing */
  status: BorrowerConfirmationStatus;
  href?: string;
};

function deriveConfirmationStatusFromFields(
  fields: BorrowerReviewField[],
  persistenceEnabled: boolean,
): BorrowerConfirmationStatus {
  const anyAvailable = fields.some((f) => f.status === "available");
  if (!anyAvailable) return "missing";
  // Confirmation persistence is required for "confirmed".
  // Without it, default to needs_confirmation.
  if (!persistenceEnabled) return "needs_confirmation";
  // Even with persistence enabled, real persisted confirmation isn't supplied
  // via this VM input shape — keep defaulting to needs_confirmation. Real
  // confirmed status must come from caller's persisted state, not derived here.
  return "needs_confirmation";
}

function buildConfirmationItems(
  input: BorrowerTrustReviewInput,
  groups: BorrowerReviewGroup[],
): BorrowerConfirmationItem[] {
  const profile = input.profile ?? {};
  const persistenceEnabled = profile.confirmationPersistenceEnabled === true;

  const businessFields = groups.find((g) => g.id === "business_information")?.fields ?? [];
  const ownershipFields = groups.find((g) => g.id === "ownership_information")?.fields ?? [];
  const contactFields = groups.find((g) => g.id === "contact_information")?.fields ?? [];

  const pkg = input.documents.packageSummary;
  const attentionCount = pkg.needsAttention;

  const items: ConfirmationPlan[] = [
    {
      id: "confirm_business",
      label: "Confirm business name and address",
      description:
        "Make sure the business legal name and address Buddy has on file match your records.",
      status: deriveConfirmationStatusFromFields(businessFields, persistenceEnabled),
      href: profile.updateBusinessHref ?? undefined,
    },
    {
      id: "confirm_ownership",
      label: "Confirm ownership details",
      description:
        "Review the owners listed on file and their ownership percentages.",
      status: deriveConfirmationStatusFromFields(ownershipFields, persistenceEnabled),
      href: profile.updateOwnershipHref ?? undefined,
    },
    {
      id: "confirm_contact",
      label: "Confirm primary contact information",
      description:
        "Check that the email and phone Buddy uses to reach you are still current.",
      status: deriveConfirmationStatusFromFields(contactFields, persistenceEnabled),
      href: profile.updateContactHref ?? undefined,
    },
    {
      id: "review_documents",
      label: "Review documents received",
      description:
        pkg.requiredReceived > 0
          ? `Buddy has received ${pkg.requiredReceived} required item${pkg.requiredReceived === 1 ? "" : "s"} so far.`
          : "Buddy will list documents here as they are received.",
      status:
        pkg.requiredReceived > 0
          ? persistenceEnabled
            ? "needs_confirmation"
            : "needs_confirmation"
          : "missing",
    },
    {
      id: "review_attention",
      label: "Review remaining attention items",
      description:
        attentionCount > 0
          ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} may need a closer look before submission preparation.`
          : "No items currently flagged for attention.",
      status: attentionCount > 0 ? "needs_confirmation" : "not_applicable",
    },
  ];

  return items.map((item) => {
    const trimmedHref = trimOrNull(item.href ?? null) ?? undefined;
    const out: BorrowerConfirmationItem = {
      id: item.id,
      label: item.label,
      description: item.description,
      status: item.status,
    };
    if (trimmedHref) out.href = trimmedHref;
    return out;
  });
}

// ---------------------------------------------------------------------------
// State derivation
// ---------------------------------------------------------------------------

function countStrictlyMissingRequired(
  input: BorrowerTrustReviewInput,
): number {
  let count = 0;
  for (const group of input.documents.groups) {
    for (const req of group.requirements) {
      if (req.required && req.status === "missing") count += 1;
    }
  }
  return count;
}

function deriveState(input: BorrowerTrustReviewInput): BorrowerTrustReviewState {
  const pkg = input.documents.packageSummary;
  const requiredTotal = pkg.requiredTotal;
  const requiredReceived = pkg.requiredReceived;
  const needsAttention = pkg.needsAttention;
  const missingRequired = countStrictlyMissingRequired(input);
  const commState = input.communication.state;

  // Not ready: package barely started
  if (requiredTotal === 0 && requiredReceived === 0) {
    return "not_ready_to_review";
  }
  if (requiredReceived === 0) {
    return "not_ready_to_review";
  }

  // Waiting on updates: critical communication block, or borrower has not
  // yet uploaded one or more strictly-missing required documents.
  if (commState === "blocked" || missingRequired > 0) {
    return "waiting_on_updates";
  }

  // Confirmations needed: items were received but flagged for attention —
  // borrower can review and confirm what's already on file.
  if (needsAttention > 0) {
    return "confirmations_needed";
  }

  // Ready to review: required documents are in and nothing is flagged.
  return "ready_to_review";
}

const STATE_HEADLINES: Record<BorrowerTrustReviewState, string> = {
  not_ready_to_review:
    "Buddy is still gathering your package before review.",
  ready_to_review:
    "Take a moment to review what Buddy has on file.",
  confirmations_needed:
    "Confirm a few details before lender package preparation.",
  reviewed:
    "Thanks — your review is saved.",
  waiting_on_updates:
    "Buddy is waiting on a few updates before this is ready to review.",
};

const STATE_SUMMARIES: Record<BorrowerTrustReviewState, string> = {
  not_ready_to_review:
    "There isn't enough on file yet to review. Continue adding requested documents and Buddy will open this section when there is something to confirm.",
  ready_to_review:
    "Look over the business, ownership, and contact details Buddy has on file. You can update anything that looks off before lender package preparation.",
  confirmations_needed:
    "A few items still need a quick confirmation. Open each one to review what Buddy has and update if anything has changed.",
  reviewed:
    "Buddy has your review on file. Your banker may still request clarification or updated documents before lender submission preparation.",
  waiting_on_updates:
    "Buddy is waiting on requested updates before this section can be reviewed. Add the remaining items and Buddy will reopen the review.",
};

const STATE_LABELS: Record<BorrowerTrustReviewState, string> = {
  not_ready_to_review: "Not ready for review yet",
  ready_to_review: "Ready to review",
  confirmations_needed: "Confirm a few details",
  reviewed: "Review saved",
  waiting_on_updates: "Waiting on updates",
};

// Exported for tests that want to assert labels match spec verbatim.
export const BORROWER_TRUST_REVIEW_STATE_LABELS = STATE_LABELS;

// ---------------------------------------------------------------------------
// Primary CTA derivation
// ---------------------------------------------------------------------------

function derivePrimaryCta(
  input: BorrowerTrustReviewInput,
  state: BorrowerTrustReviewState,
): { label?: string; href?: string } {
  if (state === "not_ready_to_review" || state === "waiting_on_updates") {
    // Direct borrower to the next attention/missing item if there's a real href.
    const firstAttention = input.submission.attentionItems.find((i) => i.href);
    if (firstAttention?.href) {
      return {
        label: "Add requested item",
        href: firstAttention.href,
      };
    }
    return {};
  }

  // For review/confirmation states, prefer the first concrete update href.
  const profile = input.profile ?? {};
  const profileHref =
    trimOrNull(profile.updateBusinessHref) ??
    trimOrNull(profile.updateOwnershipHref) ??
    trimOrNull(profile.updateContactHref) ??
    trimOrNull(profile.updateFinancingHref);
  if (profileHref) {
    return {
      label: "Update business details",
      href: profileHref,
    };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Caveat
// ---------------------------------------------------------------------------

const CAVEAT_MESSAGE =
  "Buddy uses the information and documents provided in your portal to help prepare your lender package. Your banker may still request clarification or updated documents before lender submission preparation.";

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildBorrowerTrustReviewViewModel(
  input: BorrowerTrustReviewInput,
): BorrowerTrustReviewViewModel {
  const state = deriveState(input);
  const reviewGroups = buildReviewGroups(input);
  const confirmationItems = buildConfirmationItems(input, reviewGroups);
  const packageSummary = buildPackageSummary(input);
  const cta = derivePrimaryCta(input, state);

  const vm: BorrowerTrustReviewViewModel = {
    state,
    headline: STATE_HEADLINES[state],
    summary: STATE_SUMMARIES[state],
    reviewGroups,
    confirmationItems,
    packageSummary,
    caveatMessage: CAVEAT_MESSAGE,
  };
  if (cta.label) vm.primaryCtaLabel = cta.label;
  if (cta.href) vm.primaryCtaHref = cta.href;
  return vm;
}
