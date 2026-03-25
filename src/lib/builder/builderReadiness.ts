// Phase 53A / 53A.1 / 53A.2 — Milestone readiness engine
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
  severity: "blocker" | "warning";
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
  const reviewedOwners = owners.filter(
    (o) => o.prefill_status !== "suggested",
  );
  const hasReviewedOwner = reviewedOwners.some(
    (o) => o.full_legal_name && o.ownership_pct != null && o.title,
  );

  // --- Credit Ready checks ---
  const creditChecks: ReadinessCheck[] = [
    { key: "loan_purpose_missing", label: "Loan purpose filled", met: Boolean(deal?.loan_purpose?.trim()), severity: "blocker" },
    { key: "requested_amount_missing", label: "Requested amount > 0", met: (deal?.requested_amount ?? 0) > 0, severity: "blocker" },
    { key: "loan_type_missing", label: "Loan type set", met: Boolean(deal?.loan_type), severity: "blocker" },
    { key: "entity_name_missing", label: "Legal entity name", met: Boolean(business?.legal_entity_name?.trim()), severity: "blocker" },
    { key: "entity_type_missing", label: "Entity type", met: Boolean(business?.entity_type), severity: "blocker" },
    {
      key: "owner_missing",
      label: "At least one reviewed owner with name + ownership % + title",
      met: hasReviewedOwner,
      severity: "blocker",
    },
    { key: "story_incomplete", label: "At least one story field >= 50 chars", met: storyFieldsWithMinChars(story, 50) >= 1, severity: "blocker" },
    { key: "financial_snapshot_missing", label: "Financial snapshot exists", met: serverFlags.snapshotExists, severity: "blocker" },
  ];

  // Instance-specific owner blockers
  for (const owner of reviewedOwners) {
    if (!owner.full_legal_name) {
      creditChecks.push({
        key: `owner_name_missing:${owner.id}`,
        label: `Owner "${owner.id.slice(0, 8)}..." is missing name`,
        met: false,
        severity: "blocker",
      });
    }
    if (owner.ownership_pct == null) {
      creditChecks.push({
        key: `owner_ownership_pct_missing:${owner.id}`,
        label: `${owner.full_legal_name ?? "Owner"} is missing ownership %`,
        met: false,
        severity: "blocker",
      });
    }
    if (!owner.title) {
      creditChecks.push({
        key: `owner_title_missing:${owner.id}`,
        label: `${owner.full_legal_name ?? "Owner"} is missing title`,
        met: false,
        severity: "blocker",
      });
    }
  }

  // Instance-specific collateral blockers
  for (const c of state.collateral) {
    if (!c.valuation_method) {
      creditChecks.push({
        key: `collateral_valuation_method_missing:${c.id}`,
        label: `${c.description || c.item_type} is missing valuation method`,
        met: false,
        severity: "blocker",
      });
    }
    if (c.advance_rate == null) {
      creditChecks.push({
        key: `collateral_advance_rate_missing:${c.id}`,
        label: `${c.description || c.item_type} is missing advance rate`,
        met: false,
        severity: "warning",
      });
    }
  }

  // Equity checks
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
        severity: "blocker",
      });
    }
    if (!hasSource) {
      creditChecks.push({
        key: "equity_source_of_funds_missing",
        label: "Equity source of funds",
        met: false,
        severity: "blocker",
      });
    }
    // Below-requirement warning
    if (
      hasActual &&
      structure?.equity_required_pct != null &&
      structure?.equity_actual_pct != null &&
      structure.equity_actual_pct < structure.equity_required_pct
    ) {
      creditChecks.push({
        key: "equity_below_requirement",
        label: `Equity ${(structure.equity_actual_pct * 100).toFixed(0)}% below required ${(structure.equity_required_pct * 100).toFixed(0)}%`,
        met: false,
        severity: "warning",
      });
    }
  }

  const creditMet = creditChecks.filter((c) => c.met).length;
  const creditTotal = creditChecks.length;
  const creditPct = creditTotal > 0 ? Math.round((creditMet / creditTotal) * 100) : 100;

  // --- Doc Ready checks (Credit Ready + additional) ---
  const docAdditionalChecks: ReadinessCheck[] = [
    { key: "state_of_formation_missing", label: "State of formation", met: Boolean(business?.state_of_formation?.trim()), severity: "blocker" },
    {
      key: "business_address_incomplete",
      label: "Business address complete",
      met: Boolean(
        business?.business_address?.trim() &&
        business?.city?.trim() &&
        business?.state?.trim() &&
        business?.zip?.trim(),
      ),
      severity: "blocker",
    },
    {
      key: "owner_home_address_missing",
      label: "All owners have home address",
      met:
        reviewedOwners.length > 0 &&
        reviewedOwners.every((o) => Boolean(o.home_address?.trim())),
      severity: "blocker",
    },
    {
      key: "guarantor_missing",
      label: "Guarantors configured",
      met:
        guarantors?.no_guarantors === true ||
        (guarantors?.guarantors ?? []).length > 0,
      severity: "blocker",
    },
    { key: "collateral_missing", label: "At least one collateral item", met: state.collateral.length > 0, severity: "blocker" },
    {
      key: "proceeds_mismatch",
      label: "Proceeds sum within 5% of requested",
      met: (() => {
        const requested = deal?.requested_amount ?? 0;
        if (requested <= 0) return false;
        const sum = state.proceeds.reduce((s, p) => s + (p.amount ?? 0), 0);
        return Math.abs(sum - requested) / requested <= 0.05;
      })(),
      severity: "warning",
    },
    { key: "story_incomplete", label: "3+ story fields >= 50 chars", met: storyFieldsWithMinChars(story, 50) >= 3, severity: "blocker" },
  ];

  const allDocChecks = [...creditChecks, ...docAdditionalChecks];
  const docMet = allDocChecks.filter((c) => c.met).length;
  const docTotal = allDocChecks.length;
  const docPct = docTotal > 0 ? Math.round((docMet / docTotal) * 100) : 100;

  function toBlockers(checks: ReadinessCheck[]): BuilderReadinessBlocker[] {
    return checks
      .filter((c) => !c.met)
      .map((c) => {
        // Parse instance-specific blocker keys for targeted navigation
        const target = mapBlockerToTarget(c.key);

        // Enrich target with instance IDs from key pattern "base_key:instance_id"
        const colonIdx = c.key.indexOf(":");
        if (colonIdx > 0) {
          const instanceId = c.key.slice(colonIdx + 1);
          const baseKey = c.key.slice(0, colonIdx);
          if (baseKey.startsWith("owner_")) {
            target.entity_id = instanceId;
          } else if (baseKey.startsWith("collateral_")) {
            target.collateral_id = instanceId;
          }
        }

        return {
          key: c.key,
          label: c.label,
          severity: c.severity,
          target,
        };
      });
  }

  return {
    credit_ready: creditMet === creditTotal,
    credit_ready_pct: creditPct,
    credit_ready_blockers: toBlockers(creditChecks),
    doc_ready: docMet === docTotal,
    doc_ready_pct: docPct,
    doc_ready_blockers: toBlockers(allDocChecks),
    policy_exceptions: [],
  };
}
