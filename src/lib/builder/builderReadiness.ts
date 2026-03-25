// Phase 53A / 53A.1 — Milestone readiness engine
// Pure function. No DB access.

import type {
  BuilderState,
  BuilderReadiness,
  BuilderReadinessBlocker,
  DealSectionData,
  BusinessSectionData,
  PartiesSectionData,
  GuarantorsSectionData,
  StructureSectionData,
  StorySectionData,
  ServerFlags,
} from "./builderTypes";
import { mapBlockerToTarget } from "./builderReadinessTargets";

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

type ReadinessCheck = {
  key: string;
  label: string;
  met: boolean;
};

export function computeBuilderReadiness(
  state: BuilderState,
  serverFlags: ServerFlags,
): BuilderReadiness {
  const deal = state.sections.deal as Partial<DealSectionData> | undefined;
  const business = state.sections.business as Partial<BusinessSectionData> | undefined;
  const parties = state.sections.parties as Partial<PartiesSectionData> | undefined;
  const guarantors = state.sections.guarantors as Partial<GuarantorsSectionData> | undefined;
  const structure = state.sections.structure as Partial<StructureSectionData> | undefined;
  const story = state.sections.story as Partial<StorySectionData> | undefined;

  const owners = parties?.owners ?? [];
  const hasReviewedOwner = owners.some(
    (o) =>
      o.full_legal_name &&
      o.ownership_pct != null &&
      o.title &&
      o.prefill_status !== "suggested",
  );

  // --- Credit Ready checks ---
  const creditChecks: ReadinessCheck[] = [
    { key: "loan_purpose_missing", label: "Loan purpose filled", met: Boolean(deal?.loan_purpose?.trim()) },
    { key: "requested_amount_missing", label: "Requested amount > 0", met: (deal?.requested_amount ?? 0) > 0 },
    { key: "loan_type_missing", label: "Loan type set", met: Boolean(deal?.loan_type) },
    { key: "entity_name_missing", label: "Legal entity name", met: Boolean(business?.legal_entity_name?.trim()) },
    { key: "entity_type_missing", label: "Entity type", met: Boolean(business?.entity_type) },
    {
      key: "owner_missing",
      label: "At least one reviewed owner with name + ownership % + title",
      met: hasReviewedOwner,
    },
    { key: "story_incomplete", label: "At least one story field >= 50 chars", met: storyFieldsWithMinChars(story, 50) >= 1 },
    { key: "financial_snapshot_missing", label: "Financial snapshot exists", met: serverFlags.snapshotExists },
  ];

  // Collateral checks (if deal has collateral)
  if (state.collateral.length > 0) {
    const allHaveMethod = state.collateral.every((c) => Boolean(c.valuation_method));
    const allHaveAdvanceRate = state.collateral.every((c) => c.advance_rate != null);
    if (!allHaveMethod) {
      creditChecks.push({
        key: "collateral_valuation_method_missing",
        label: "All collateral items have valuation method",
        met: false,
      });
    }
    if (!allHaveAdvanceRate) {
      creditChecks.push({
        key: "collateral_advance_rate_missing",
        label: "All collateral items have advance rate",
        met: false,
      });
    }
  }

  // Equity check (if equity fields are partially filled or product likely requires it)
  const hasEquityFields =
    structure?.equity_required_pct != null ||
    structure?.equity_actual_pct != null ||
    structure?.equity_injection_amount != null;
  if (hasEquityFields) {
    const hasActual =
      (structure?.equity_actual_pct ?? 0) > 0 ||
      (structure?.equity_actual_amount ?? 0) > 0 ||
      (structure?.equity_injection_amount ?? 0) > 0;
    const hasSource = Boolean(structure?.equity_injection_source?.trim());
    if (!hasActual) {
      creditChecks.push({
        key: "equity_injection_missing",
        label: "Equity injection amount or percentage",
        met: false,
      });
    }
    if (!hasSource) {
      creditChecks.push({
        key: "equity_source_of_funds_missing",
        label: "Equity source of funds",
        met: false,
      });
    }
  }

  const creditMet = creditChecks.filter((c) => c.met).length;
  const creditTotal = creditChecks.length;
  const creditPct = Math.round((creditMet / creditTotal) * 100);

  // --- Doc Ready checks (Credit Ready + additional) ---
  const docAdditionalChecks: ReadinessCheck[] = [
    { key: "state_of_formation_missing", label: "State of formation", met: Boolean(business?.state_of_formation?.trim()) },
    {
      key: "business_address_incomplete",
      label: "Business address complete",
      met: Boolean(
        business?.business_address?.trim() &&
        business?.city?.trim() &&
        business?.state?.trim() &&
        business?.zip?.trim(),
      ),
    },
    {
      key: "owner_home_address_missing",
      label: "All owners have home address",
      met:
        owners.length > 0 &&
        owners.every((o) => Boolean(o.home_address?.trim())),
    },
    {
      key: "guarantor_missing",
      label: "Guarantors configured",
      met:
        guarantors?.no_guarantors === true ||
        (guarantors?.guarantors ?? []).length > 0,
    },
    { key: "collateral_missing", label: "At least one collateral item", met: state.collateral.length > 0 },
    {
      key: "proceeds_mismatch",
      label: "Proceeds sum within 5% of requested",
      met: (() => {
        const requested = deal?.requested_amount ?? 0;
        if (requested <= 0) return false;
        const sum = state.proceeds.reduce((s, p) => s + (p.amount ?? 0), 0);
        return Math.abs(sum - requested) / requested <= 0.05;
      })(),
    },
    { key: "story_incomplete", label: "3+ story fields >= 50 chars", met: storyFieldsWithMinChars(story, 50) >= 3 },
  ];

  const allDocChecks = [...creditChecks, ...docAdditionalChecks];
  const docMet = allDocChecks.filter((c) => c.met).length;
  const docTotal = allDocChecks.length;
  const docPct = Math.round((docMet / docTotal) * 100);

  function toBlockers(checks: ReadinessCheck[]): BuilderReadinessBlocker[] {
    return checks
      .filter((c) => !c.met)
      .map((c) => ({
        key: c.key,
        label: c.label,
        target: mapBlockerToTarget(c.key),
      }));
  }

  return {
    credit_ready: creditMet === creditTotal,
    credit_ready_pct: creditPct,
    credit_ready_blockers: toBlockers(creditChecks),
    doc_ready: docMet === docTotal,
    doc_ready_pct: docPct,
    doc_ready_blockers: toBlockers(allDocChecks),
  };
}
