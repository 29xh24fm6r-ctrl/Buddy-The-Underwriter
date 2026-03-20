// Phase 53A — Step completion scoring
// Pure functions, no DB access. Driven entirely by BuilderState.

import type {
  BuilderState,
  BuilderStepKey,
  StepCompletion,
  DealSectionData,
  BusinessSectionData,
  PartiesSectionData,
  StorySectionData,
  ServerFlags,
} from "./builderTypes";

const STEP_LABELS: Record<BuilderStepKey, string> = {
  overview: "Overview",
  parties: "Parties",
  loan_request: "Loan Request",
  financials: "Financials",
  collateral: "Collateral",
  risk: "Risk",
  documents: "Documents",
  story: "Story",
  review: "Review",
};

const STORY_FIELDS = [
  "loan_purpose_narrative",
  "management_qualifications",
  "competitive_position",
  "known_weaknesses",
  "deal_strengths",
  "committee_notes",
] as const;

function countStoryFieldsWithMinChars(
  story: Partial<StorySectionData> | undefined,
  minChars: number,
): number {
  if (!story) return 0;
  return STORY_FIELDS.filter((k) => {
    const val = story[k];
    return typeof val === "string" && val.trim().length >= minChars;
  }).length;
}

function computePartiesPct(parties: Partial<PartiesSectionData> | undefined): {
  pct: number;
  warnings: number;
} {
  const owners = parties?.owners ?? [];
  if (owners.length === 0) return { pct: 0, warnings: 0 };
  const valid = owners.filter(
    (o) => o.full_legal_name && o.ownership_pct != null && o.title,
  );
  if (valid.length > 0) return { pct: 100, warnings: owners.length - valid.length };
  return { pct: Math.round((valid.length / Math.max(owners.length, 1)) * 100), warnings: owners.length - valid.length };
}

function computeLoanRequestPct(deal: Partial<DealSectionData> | undefined): number {
  if (!deal) return 0;
  const required = ["loan_purpose", "requested_amount", "loan_type", "desired_term_months"] as const;
  const filled = required.filter((k) => {
    const v = deal[k];
    if (v == null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (typeof v === "number") return v > 0;
    return true;
  });
  return Math.round((filled.length / required.length) * 100);
}

function computeStoryPct(story: Partial<StorySectionData> | undefined): number {
  const count = countStoryFieldsWithMinChars(story, 50);
  // 3 of 6 = complete
  return Math.min(100, Math.round((count / 3) * 100));
}

export function computeStepCompletions(
  state: BuilderState,
  serverFlags: ServerFlags,
): StepCompletion[] {
  const deal = state.sections.deal as Partial<DealSectionData> | undefined;
  const business = state.sections.business as Partial<BusinessSectionData> | undefined;
  const parties = state.sections.parties as Partial<PartiesSectionData> | undefined;
  const story = state.sections.story as Partial<StorySectionData> | undefined;

  const partiesResult = computePartiesPct(parties);
  const loanPct = computeLoanRequestPct(deal);
  const storyPct = computeStoryPct(story);

  const steps: StepCompletion[] = [
    { key: "overview", label: STEP_LABELS.overview, pct: 100, complete: true, warnings: 0, blockers: 0 },
    {
      key: "parties",
      label: STEP_LABELS.parties,
      pct: partiesResult.pct,
      complete: partiesResult.pct >= 100,
      warnings: partiesResult.warnings,
      blockers: 0,
    },
    {
      key: "loan_request",
      label: STEP_LABELS.loan_request,
      pct: loanPct,
      complete: loanPct >= 100,
      warnings: 0,
      blockers: 0,
    },
    {
      key: "financials",
      label: STEP_LABELS.financials,
      pct: serverFlags.snapshotExists ? 100 : 0,
      complete: serverFlags.snapshotExists,
      warnings: 0,
      blockers: 0,
    },
    {
      key: "collateral",
      label: STEP_LABELS.collateral,
      pct: state.collateral.length > 0 ? 100 : 0,
      complete: state.collateral.length > 0,
      warnings: 0,
      blockers: 0,
    },
    {
      key: "risk",
      label: STEP_LABELS.risk,
      pct: serverFlags.riskRunExists ? 100 : 0,
      complete: serverFlags.riskRunExists,
      warnings: 0,
      blockers: 0,
    },
    {
      key: "documents",
      label: STEP_LABELS.documents,
      pct: serverFlags.documentsReady ? 100 : 0,
      complete: serverFlags.documentsReady,
      warnings: 0,
      blockers: 0,
    },
    {
      key: "story",
      label: STEP_LABELS.story,
      pct: storyPct,
      complete: storyPct >= 100,
      warnings: 0,
      blockers: 0,
    },
  ];

  // Review: computed from all above
  const totalPct = steps.reduce((s, st) => s + st.pct, 0);
  const avgPct = Math.round(totalPct / steps.length);
  steps.push({
    key: "review",
    label: STEP_LABELS.review,
    pct: avgPct,
    complete: steps.every((s) => s.complete),
    warnings: steps.reduce((s, st) => s + st.warnings, 0),
    blockers: steps.reduce((s, st) => s + st.blockers, 0),
  });

  return steps;
}

export function computeOverallPct(steps: StepCompletion[]): number {
  if (steps.length === 0) return 0;
  const total = steps.reduce((s, st) => s + st.pct, 0);
  return Math.round(total / steps.length);
}
