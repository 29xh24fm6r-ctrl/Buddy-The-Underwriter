/**
 * Borrower Submission Readiness & Package Handoff — View Model Builder
 *
 * Deterministic, pure-function synthesizer that produces a borrower-safe
 * submission readiness summary from existing borrower VMs.
 *
 * Spec: 15L / Spec 8 — Submission Readiness & Lender Package Handoff
 *
 * Rules:
 * - Pure function, no DB or network calls
 * - Operational readiness only — NOT credit or approval readiness
 * - No lender commitment language; no fabricated timing
 * - Borrower-safe plain English only
 * - Deterministic ordering for testability
 */

import type { BorrowerJourneyViewModel } from "@/lib/borrower/buildBorrowerJourneyViewModel";
import type { BorrowerReadinessViewModel } from "@/lib/borrower/buildBorrowerReadinessViewModel";
import type { BorrowerGuidanceViewModel } from "@/lib/borrower/buildBorrowerGuidanceViewModel";
import type { BorrowerCommunicationViewModel } from "@/lib/borrower/buildBorrowerCommunicationViewModel";
import type {
  BorrowerDocumentExperienceViewModel,
  BorrowerDocumentGroup,
} from "@/lib/borrower/buildBorrowerDocumentExperienceViewModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BorrowerSubmissionReadinessBand =
  | "early_preparation"
  | "progressing"
  | "near_submission_preparation"
  | "submission_preparation_ready";

export type BorrowerSubmissionFrictionSignal =
  | "missing_required_documents"
  | "unresolved_attention_items"
  | "incomplete_forms"
  | "missing_financials"
  | "clarification_needed"
  | "waiting_on_review"
  | "no_major_submission_blockers";

export type BorrowerSubmissionChecklistItem = {
  id: string;
  label: string;
  completed: boolean;
  description?: string;
  href?: string;
};

export type BorrowerSubmissionPackageItemCategory =
  | "financial"
  | "forms"
  | "identity"
  | "ownership"
  | "business_documents"
  | "supporting";

export type BorrowerSubmissionPackageItem = {
  id: string;
  label: string;
  category: BorrowerSubmissionPackageItemCategory;
};

export type BorrowerSubmissionAttentionItem = {
  id: string;
  label: string;
  description?: string;
  priority: "required" | "helpful" | "optional";
  href?: string;
};

export type BorrowerSubmissionNextStep = {
  headline: string;
  description: string;
};

export type BorrowerSubmissionReadinessViewModel = {
  band: BorrowerSubmissionReadinessBand;
  bandLabel: string;
  headline: string;
  summary: string;
  readinessPercent?: number;
  checklist: BorrowerSubmissionChecklistItem[];
  packageItems: BorrowerSubmissionPackageItem[];
  attentionItems: BorrowerSubmissionAttentionItem[];
  nextSteps: BorrowerSubmissionNextStep[];
  frictionSignals: BorrowerSubmissionFrictionSignal[];
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type SubmissionReadinessInput = {
  token: string;
  journey: BorrowerJourneyViewModel;
  readiness?: BorrowerReadinessViewModel;
  guidance: BorrowerGuidanceViewModel;
  communication: BorrowerCommunicationViewModel;
  documents: BorrowerDocumentExperienceViewModel;
};

// ---------------------------------------------------------------------------
// Band derivation
// ---------------------------------------------------------------------------

function deriveBand(input: SubmissionReadinessInput): BorrowerSubmissionReadinessBand {
  const pkg = input.documents.packageSummary;
  const commState = input.communication.state;
  const pct = input.journey.progressPercent;

  // If all required received, no attention items, no critical blockers
  if (
    pkg.requiredRemaining === 0 &&
    pkg.needsAttention === 0 &&
    commState !== "blocked"
  ) {
    return "submission_preparation_ready";
  }

  // If nearly there: <= 2 remaining, no blockers
  if (
    pkg.requiredRemaining <= 2 &&
    pkg.needsAttention === 0 &&
    commState !== "blocked"
  ) {
    return "near_submission_preparation";
  }

  // If some real progress
  if (pct >= 25 || pkg.requiredReceived > 0) {
    return "progressing";
  }

  return "early_preparation";
}

const BAND_LABELS: Record<BorrowerSubmissionReadinessBand, string> = {
  early_preparation: "Preparing your package",
  progressing: "Building your file",
  near_submission_preparation: "Nearly ready",
  submission_preparation_ready: "Preparing for lender submission",
};

// ---------------------------------------------------------------------------
// Headline / summary
// ---------------------------------------------------------------------------

function buildHeadline(band: BorrowerSubmissionReadinessBand): string {
  switch (band) {
    case "submission_preparation_ready":
      return "Your package appears ready for lender submission preparation.";
    case "near_submission_preparation":
      return "Your package is nearly ready for submission preparation.";
    case "progressing":
      return "Your package is being assembled.";
    case "early_preparation":
      return "Buddy is preparing your SBA package.";
  }
}

function buildSummary(
  band: BorrowerSubmissionReadinessBand,
  input: SubmissionReadinessInput,
): string {
  const remaining = input.documents.packageSummary.requiredRemaining;

  switch (band) {
    case "submission_preparation_ready":
      return "All required items have been received. Buddy and your banker may still review for completeness before final submission preparation.";
    case "near_submission_preparation":
      return `${remaining} required item${remaining === 1 ? "" : "s"} still needed before the package can be prepared for lender submission.`;
    case "progressing":
      return "Buddy has received some documents and is organizing them. Continue adding requested items to move toward submission readiness.";
    case "early_preparation":
      return "Buddy will list the first document requests here and guide you through each one. Your package is just getting started.";
  }
}

// ---------------------------------------------------------------------------
// Readiness checklist
// ---------------------------------------------------------------------------

const GROUP_ID_TO_CHECKLIST: Record<string, { id: string; label: string }> = {
  business_financials: {
    id: "chk_financials",
    label: "Financial package received",
  },
  tax_returns: {
    id: "chk_tax",
    label: "Required documents received",
  },
  sba_forms: {
    id: "chk_sba",
    label: "SBA forms completed",
  },
  ownership_identity: {
    id: "chk_ownership",
    label: "Ownership and identity received",
  },
  business_documents: {
    id: "chk_business_docs",
    label: "Business documents received",
  },
  supporting_documents: {
    id: "chk_supporting",
    label: "Supporting documents received",
  },
};

function buildChecklist(
  input: SubmissionReadinessInput,
): BorrowerSubmissionChecklistItem[] {
  const items: BorrowerSubmissionChecklistItem[] = [];
  const groups = input.documents.groups;

  for (const group of groups) {
    const mapping = GROUP_ID_TO_CHECKLIST[group.id];
    if (!mapping) continue;

    const requiredInGroup = group.requirements.filter((r) => r.required);
    const receivedInGroup = requiredInGroup.filter(
      (r) =>
        r.status === "received" ||
        r.status === "accepted" ||
        r.status === "reviewing" ||
        r.status === "uploaded",
    );
    const complete = requiredInGroup.length > 0 && receivedInGroup.length === requiredInGroup.length;

    items.push({
      id: mapping.id,
      label: mapping.label,
      completed: complete,
      description: complete
        ? `${receivedInGroup.length} of ${requiredInGroup.length} received`
        : `${receivedInGroup.length} of ${requiredInGroup.length} received — ${requiredInGroup.length - receivedInGroup.length} still needed`,
    });
  }

  // Attention items resolved
  const attention = input.documents.packageSummary.needsAttention;
  items.push({
    id: "chk_attention",
    label: "Attention items resolved",
    completed: attention === 0,
    description:
      attention === 0
        ? "No items currently need attention"
        : `${attention} item${attention === 1 ? "" : "s"} still need${attention === 1 ? "s" : ""} attention`,
  });

  // Guidance follow-ups
  const hasOpenGuidance =
    input.guidance.coachedItems.length > 0 &&
    input.communication.state === "action_needed";
  items.push({
    id: "chk_guidance",
    label: "Guidance follow-ups addressed",
    completed: !hasOpenGuidance,
    description: hasOpenGuidance
      ? "Buddy has flagged items that may help before submission preparation"
      : "No open guidance follow-ups",
  });

  return items;
}

// ---------------------------------------------------------------------------
// Package items (received inventory)
// ---------------------------------------------------------------------------

const GROUP_TO_CATEGORY: Record<string, BorrowerSubmissionPackageItemCategory> = {
  business_financials: "financial",
  tax_returns: "financial",
  sba_forms: "forms",
  ownership_identity: "ownership",
  business_documents: "business_documents",
  supporting_documents: "supporting",
};

function buildPackageItems(
  input: SubmissionReadinessInput,
): BorrowerSubmissionPackageItem[] {
  const items: BorrowerSubmissionPackageItem[] = [];

  for (const group of input.documents.groups) {
    const category = GROUP_TO_CATEGORY[group.id] ?? "supporting";
    for (const req of group.requirements) {
      const isReceived =
        req.status === "received" ||
        req.status === "accepted" ||
        req.status === "reviewing" ||
        req.status === "uploaded";
      if (!isReceived) continue;
      items.push({
        id: `pkg_${req.id}`,
        label: req.label,
        category,
      });
    }
  }

  // Deterministic sort: category then label
  const catOrder: BorrowerSubmissionPackageItemCategory[] = [
    "financial",
    "forms",
    "ownership",
    "identity",
    "business_documents",
    "supporting",
  ];
  items.sort((a, b) => {
    const ca = catOrder.indexOf(a.category);
    const cb = catOrder.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return a.label.localeCompare(b.label);
  });

  return items;
}

// ---------------------------------------------------------------------------
// Attention items (remaining)
// ---------------------------------------------------------------------------

function buildAttentionItems(
  input: SubmissionReadinessInput,
): BorrowerSubmissionAttentionItem[] {
  const items: BorrowerSubmissionAttentionItem[] = [];

  // Required missing documents
  for (const group of input.documents.groups) {
    for (const req of group.requirements) {
      if (req.required && req.status === "missing") {
        items.push({
          id: `att_missing_${req.id}`,
          label: req.label,
          description: req.guidance.whyItMatters,
          priority: "required",
          href: req.href,
        });
      }
    }
  }

  // Needs attention documents
  for (const group of input.documents.groups) {
    for (const req of group.requirements) {
      if (req.status === "needs_attention") {
        items.push({
          id: `att_attention_${req.id}`,
          label: req.label,
          description:
            req.recoveryMessage ??
            "Buddy may need a clearer copy or all pages included.",
          priority: "required",
          href: req.href,
        });
      }
    }
  }

  // High-priority communication response items not already covered
  const seen = new Set(items.map((i) => i.label.toLowerCase()));
  for (const resp of input.communication.responseNeededItems) {
    if (seen.has(resp.label.toLowerCase())) continue;
    items.push({
      id: `att_comm_${resp.id}`,
      label: resp.label,
      description: resp.reason,
      priority: resp.priority,
      href: resp.href,
    });
  }

  // Sort: required > helpful > optional, then label
  const prioRank = { required: 0, helpful: 1, optional: 2 };
  items.sort((a, b) => {
    const pa = prioRank[a.priority];
    const pb = prioRank[b.priority];
    if (pa !== pb) return pa - pb;
    return a.label.localeCompare(b.label);
  });

  return items;
}

// ---------------------------------------------------------------------------
// Next steps
// ---------------------------------------------------------------------------

function buildNextSteps(
  band: BorrowerSubmissionReadinessBand,
): BorrowerSubmissionNextStep[] {
  const steps: BorrowerSubmissionNextStep[] = [];

  if (band === "submission_preparation_ready") {
    steps.push({
      headline: "Banker review",
      description:
        "Buddy and your banker may review the complete package for accuracy and completeness before proceeding with lender submission preparation.",
    });
    steps.push({
      headline: "Possible follow-ups",
      description:
        "Additional clarification or updated documents may occasionally be requested even after the package appears complete.",
    });
    steps.push({
      headline: "Lender submission preparation",
      description:
        "Once the package passes final review, it will be organized for lender submission. Submission readiness reflects package preparation status, not a lending decision.",
    });
  } else {
    steps.push({
      headline: "Complete remaining items",
      description:
        "Continue uploading requested documents. Each item you complete moves the package closer to submission readiness.",
    });
    steps.push({
      headline: "Buddy reviews each upload",
      description:
        "Buddy will check uploaded documents and update your package status in plain English.",
    });
    steps.push({
      headline: "Submission preparation",
      description:
        "Once all required items are received and reviewed, the package will be prepared for lender submission.",
    });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Friction signals
// ---------------------------------------------------------------------------

function deriveFrictionSignals(
  input: SubmissionReadinessInput,
): BorrowerSubmissionFrictionSignal[] {
  const signals: BorrowerSubmissionFrictionSignal[] = [];
  const pkg = input.documents.packageSummary;

  if (pkg.requiredRemaining > 0) {
    signals.push("missing_required_documents");
  }

  if (pkg.needsAttention > 0) {
    signals.push("unresolved_attention_items");
  }

  // Check for missing SBA forms specifically
  const sbaGroup = input.documents.groups.find((g) => g.id === "sba_forms");
  if (sbaGroup) {
    const sbaIncomplete = sbaGroup.requirements.some(
      (r) => r.required && (r.status === "missing" || r.status === "needs_attention"),
    );
    if (sbaIncomplete) signals.push("incomplete_forms");
  }

  // Check for missing financials
  const finGroup = input.documents.groups.find(
    (g) => g.id === "business_financials" || g.id === "tax_returns",
  );
  if (finGroup) {
    const finIncomplete = finGroup.requirements.some(
      (r) => r.required && r.status === "missing",
    );
    if (finIncomplete) signals.push("missing_financials");
  }

  if (
    input.communication.state === "waiting_on_review" ||
    input.communication.waitingOn === "buddy_review" ||
    input.communication.waitingOn === "banker_review"
  ) {
    signals.push("waiting_on_review");
  }

  if (input.communication.waitingOn === "clarification") {
    signals.push("clarification_needed");
  }

  if (signals.length === 0) {
    signals.push("no_major_submission_blockers");
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Readiness percent
// ---------------------------------------------------------------------------

function computeReadinessPercent(
  input: SubmissionReadinessInput,
): number | undefined {
  const pkg = input.documents.packageSummary;
  if (pkg.requiredTotal === 0) return undefined;
  return Math.max(
    0,
    Math.min(100, Math.round((pkg.requiredReceived / pkg.requiredTotal) * 100)),
  );
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildBorrowerSubmissionReadinessViewModel(
  input: SubmissionReadinessInput,
): BorrowerSubmissionReadinessViewModel {
  const band = deriveBand(input);
  const headline = buildHeadline(band);
  const summary = buildSummary(band, input);
  const readinessPercent = computeReadinessPercent(input);
  const checklist = buildChecklist(input);
  const packageItems = buildPackageItems(input);
  const attentionItems = buildAttentionItems(input);
  const nextSteps = buildNextSteps(band);
  const frictionSignals = deriveFrictionSignals(input);

  return {
    band,
    bandLabel: BAND_LABELS[band],
    headline,
    summary,
    readinessPercent,
    checklist,
    packageItems,
    attentionItems,
    nextSteps,
    frictionSignals,
  };
}
