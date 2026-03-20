// Phase 53A — Milestone readiness engine
// Pure function. No DB access.

import type {
  BuilderState,
  BuilderReadiness,
  DealSectionData,
  BusinessSectionData,
  PartiesSectionData,
  GuarantorsSectionData,
  StorySectionData,
  ServerFlags,
} from "./builderTypes";

const STORY_FIELDS = [
  "loan_purpose_narrative",
  "management_qualifications",
  "competitive_position",
  "known_weaknesses",
  "deal_strengths",
  "committee_notes",
] as const;

function storyFieldsWithMinChars(
  story: Partial<StorySectionData> | undefined,
  min: number,
): number {
  if (!story) return 0;
  return STORY_FIELDS.filter((k) => {
    const v = story[k];
    return typeof v === "string" && v.trim().length >= min;
  }).length;
}

export function computeBuilderReadiness(
  state: BuilderState,
  serverFlags: ServerFlags,
): BuilderReadiness {
  const deal = state.sections.deal as Partial<DealSectionData> | undefined;
  const business = state.sections.business as Partial<BusinessSectionData> | undefined;
  const parties = state.sections.parties as Partial<PartiesSectionData> | undefined;
  const guarantors = state.sections.guarantors as Partial<GuarantorsSectionData> | undefined;
  const story = state.sections.story as Partial<StorySectionData> | undefined;

  // --- Credit Ready checks ---
  const creditChecks: { label: string; met: boolean }[] = [
    { label: "Loan purpose filled", met: Boolean(deal?.loan_purpose?.trim()) },
    { label: "Requested amount > 0", met: (deal?.requested_amount ?? 0) > 0 },
    { label: "Loan type set", met: Boolean(deal?.loan_type) },
    { label: "Legal entity name", met: Boolean(business?.legal_entity_name?.trim()) },
    { label: "Entity type", met: Boolean(business?.entity_type) },
    {
      label: "At least one owner with name + ownership % + title",
      met: (parties?.owners ?? []).some(
        (o) => o.full_legal_name && o.ownership_pct != null && o.title,
      ),
    },
    { label: "At least one story field >= 50 chars", met: storyFieldsWithMinChars(story, 50) >= 1 },
    { label: "Financial snapshot exists", met: serverFlags.snapshotExists },
  ];

  const creditMet = creditChecks.filter((c) => c.met).length;
  const creditTotal = creditChecks.length;
  const creditPct = Math.round((creditMet / creditTotal) * 100);

  // --- Doc Ready checks (Credit Ready + additional) ---
  const docAdditionalChecks: { label: string; met: boolean }[] = [
    { label: "State of formation", met: Boolean(business?.state_of_formation?.trim()) },
    {
      label: "Business address complete",
      met: Boolean(
        business?.business_address?.trim() &&
        business?.city?.trim() &&
        business?.state?.trim() &&
        business?.zip?.trim(),
      ),
    },
    {
      label: "All owners have home address",
      met:
        (parties?.owners ?? []).length > 0 &&
        (parties?.owners ?? []).every((o) => Boolean(o.home_address?.trim())),
    },
    {
      label: "Guarantors configured",
      met:
        guarantors?.no_guarantors === true ||
        (guarantors?.guarantors ?? []).length > 0,
    },
    { label: "At least one collateral item", met: state.collateral.length > 0 },
    {
      label: "Proceeds sum within 5% of requested",
      met: (() => {
        const requested = deal?.requested_amount ?? 0;
        if (requested <= 0) return false;
        const sum = state.proceeds.reduce((s, p) => s + (p.amount ?? 0), 0);
        return Math.abs(sum - requested) / requested <= 0.05;
      })(),
    },
    { label: "3+ story fields >= 50 chars", met: storyFieldsWithMinChars(story, 50) >= 3 },
  ];

  const allDocChecks = [...creditChecks, ...docAdditionalChecks];
  const docMet = allDocChecks.filter((c) => c.met).length;
  const docTotal = allDocChecks.length;
  const docPct = Math.round((docMet / docTotal) * 100);

  return {
    credit_ready: creditMet === creditTotal,
    credit_ready_pct: creditPct,
    credit_ready_blockers: creditChecks.filter((c) => !c.met).map((c) => c.label),
    doc_ready: docMet === docTotal,
    doc_ready_pct: docPct,
    doc_ready_blockers: allDocChecks.filter((c) => !c.met).map((c) => c.label),
  };
}
