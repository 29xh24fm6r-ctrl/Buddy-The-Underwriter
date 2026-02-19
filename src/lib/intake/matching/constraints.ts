/**
 * Buddy Institutional Document Matching Engine v1 — Positive Constraints
 *
 * Pure function. No server-only, no DB, no IO.
 *
 * ALL constraints must be satisfied for a slot to be a valid candidate.
 * FINANCIAL_STATEMENT is NOT in the equivalence map — it fails doc_type_match.
 */

import type { DocumentIdentity, SlotSnapshot, ConstraintResult } from "./types";

// ---------------------------------------------------------------------------
// Strict equivalence map (NO umbrella types)
// ---------------------------------------------------------------------------

/**
 * Maps effectiveDocType → set of acceptable slot requiredDocType values.
 *
 * FINANCIAL_STATEMENT is deliberately ABSENT. It cannot auto-match any slot.
 */
const DOC_TYPE_EQUIVALENCE: Record<string, string[]> = {
  // Business tax returns
  IRS_BUSINESS: ["BUSINESS_TAX_RETURN"],
  BUSINESS_TAX_RETURN: ["BUSINESS_TAX_RETURN"],

  // Personal tax returns
  IRS_PERSONAL: ["PERSONAL_TAX_RETURN"],
  PERSONAL_TAX_RETURN: ["PERSONAL_TAX_RETURN"],

  // Personal financial statement
  PFS: ["PERSONAL_FINANCIAL_STATEMENT"],
  PERSONAL_FINANCIAL_STATEMENT: ["PERSONAL_FINANCIAL_STATEMENT"],

  // Income statement / T12
  T12: ["INCOME_STATEMENT"],
  INCOME_STATEMENT: ["INCOME_STATEMENT"],

  // Balance sheet (exact match only)
  BALANCE_SHEET: ["BALANCE_SHEET"],

  // Rent roll (exact match only)
  RENT_ROLL: ["RENT_ROLL"],

  // Bank statement (exact match only)
  BANK_STATEMENT: ["BANK_STATEMENT"],
};

// Year-based slot doc types (require exact year match)
const YEAR_BASED_SLOT_TYPES = new Set([
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
]);

// ---------------------------------------------------------------------------
// Constraint evaluators
// ---------------------------------------------------------------------------

function checkSlotEmpty(slot: SlotSnapshot): ConstraintResult {
  const satisfied = slot.status === "empty";
  return {
    satisfied,
    constraint: "slot_empty",
    detail: satisfied
      ? "Slot is empty"
      : `Slot status is "${slot.status}" — non-empty slots are never overwritten`,
  };
}

function checkDocTypeMatch(
  identity: DocumentIdentity,
  slot: SlotSnapshot,
): ConstraintResult {
  const acceptableSlotTypes =
    DOC_TYPE_EQUIVALENCE[identity.effectiveDocType] ?? [];
  const satisfied = acceptableSlotTypes.includes(slot.requiredDocType);
  return {
    satisfied,
    constraint: "doc_type_match",
    detail: satisfied
      ? `"${identity.effectiveDocType}" matches slot type "${slot.requiredDocType}"`
      : `"${identity.effectiveDocType}" does not match slot type "${slot.requiredDocType}"`,
  };
}

function checkTaxYearMatch(
  identity: DocumentIdentity,
  slot: SlotSnapshot,
): ConstraintResult {
  // Only applies to year-based slot types
  if (!YEAR_BASED_SLOT_TYPES.has(slot.requiredDocType)) {
    return {
      satisfied: true,
      constraint: "tax_year_match",
      detail: "Slot is not year-based — year constraint skipped",
    };
  }

  if (slot.requiredTaxYear == null) {
    return {
      satisfied: true,
      constraint: "tax_year_match",
      detail: "Slot has no year requirement",
    };
  }

  const satisfied = identity.taxYear === slot.requiredTaxYear;
  return {
    satisfied,
    constraint: "tax_year_match",
    detail: satisfied
      ? `Tax year ${identity.taxYear} matches slot year ${slot.requiredTaxYear}`
      : `Tax year ${identity.taxYear ?? "null"} does not match slot year ${slot.requiredTaxYear}`,
  };
}

function checkYearRequired(
  identity: DocumentIdentity,
  slot: SlotSnapshot,
): ConstraintResult {
  if (!YEAR_BASED_SLOT_TYPES.has(slot.requiredDocType)) {
    return {
      satisfied: true,
      constraint: "year_required",
      detail: "Slot is not year-based — year not required",
    };
  }

  if (slot.requiredTaxYear == null) {
    return {
      satisfied: true,
      constraint: "year_required",
      detail: "Slot has no year requirement",
    };
  }

  const satisfied = identity.taxYear != null;
  return {
    satisfied,
    constraint: "year_required",
    detail: satisfied
      ? `Document has tax year ${identity.taxYear}`
      : "Document has no tax year but slot requires one",
  };
}

// ---------------------------------------------------------------------------
// v1.1 Constraints: Period gating
// ---------------------------------------------------------------------------

/**
 * Year-confidence gate: if slot requires a year AND period extraction found
 * low confidence, the document lacks sufficient signal to match year slots.
 * Skips when identity.period is null (backward compat with v1.0).
 */
function checkYearConfidenceSufficient(
  identity: DocumentIdentity,
  slot: SlotSnapshot,
): ConstraintResult {
  if (!YEAR_BASED_SLOT_TYPES.has(slot.requiredDocType) || slot.requiredTaxYear == null) {
    return {
      satisfied: true,
      constraint: "year_confidence_sufficient",
      detail: "Slot is not year-bound — year confidence check skipped",
    };
  }

  if (!identity.period) {
    return {
      satisfied: true,
      constraint: "year_confidence_sufficient",
      detail: "No period extraction — check skipped (v1.0 compat)",
    };
  }

  const satisfied = identity.period.taxYearConfidence >= 0.70;
  return {
    satisfied,
    constraint: "year_confidence_sufficient",
    detail: satisfied
      ? `Tax year confidence ${identity.period.taxYearConfidence} meets threshold 0.70`
      : `Tax year confidence ${identity.period.taxYearConfidence} below threshold 0.70 — insufficient for year-bound slot`,
  };
}

/**
 * Multi-year gate: if slot requires a specific year AND document spans
 * multiple years, it cannot be auto-matched to a single year's slot.
 * Skips when identity.period is null (backward compat with v1.0).
 */
function checkNotMultiYear(
  identity: DocumentIdentity,
  slot: SlotSnapshot,
): ConstraintResult {
  if (!YEAR_BASED_SLOT_TYPES.has(slot.requiredDocType) || slot.requiredTaxYear == null) {
    return {
      satisfied: true,
      constraint: "not_multi_year",
      detail: "Slot is not year-bound — multi-year check skipped",
    };
  }

  if (!identity.period) {
    return {
      satisfied: true,
      constraint: "not_multi_year",
      detail: "No period extraction — check skipped (v1.0 compat)",
    };
  }

  const satisfied = !identity.period.multiYear;
  return {
    satisfied,
    constraint: "not_multi_year",
    detail: satisfied
      ? "Document is not multi-year"
      : "Document spans multiple years — cannot auto-match to a single year slot",
  };
}

// ---------------------------------------------------------------------------
// v1.1 Constraints: Entity routing
// ---------------------------------------------------------------------------

/**
 * Entity ID match: if slot has a required_entity_id, the document's resolved
 * entity must match. Skips when slot has no entity requirement.
 */
function checkEntityIdMatch(
  identity: DocumentIdentity,
  slot: SlotSnapshot,
): ConstraintResult {
  if (!slot.requiredEntityId) {
    return {
      satisfied: true,
      constraint: "entity_id_match",
      detail: "Slot has no entity ID requirement",
    };
  }

  if (!identity.entity) {
    return {
      satisfied: false,
      constraint: "entity_id_match",
      detail: "Slot requires entity ID but no entity was resolved",
    };
  }

  const satisfied = identity.entity.entityId === slot.requiredEntityId;
  return {
    satisfied,
    constraint: "entity_id_match",
    detail: satisfied
      ? `Entity ${identity.entity.entityId} matches slot requirement`
      : `Entity ${identity.entity.entityId ?? "null"} does not match slot entity ${slot.requiredEntityId}`,
  };
}

/**
 * Entity role match: if slot has a required_entity_role, the document's resolved
 * entity role must match. Skips when slot has no role requirement.
 */
function checkEntityRoleMatch(
  identity: DocumentIdentity,
  slot: SlotSnapshot,
): ConstraintResult {
  if (!slot.requiredEntityRole) {
    return {
      satisfied: true,
      constraint: "entity_role_match",
      detail: "Slot has no entity role requirement",
    };
  }

  if (!identity.entity) {
    return {
      satisfied: false,
      constraint: "entity_role_match",
      detail: "Slot requires entity role but no entity was resolved",
    };
  }

  const satisfied = identity.entity.entityRole === slot.requiredEntityRole;
  return {
    satisfied,
    constraint: "entity_role_match",
    detail: satisfied
      ? `Entity role "${identity.entity.entityRole}" matches slot requirement`
      : `Entity role "${identity.entity.entityRole ?? "null"}" does not match slot role "${slot.requiredEntityRole}"`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate all positive constraints for a (document, slot) pair.
 * ALL must be satisfied for the slot to be a valid candidate.
 */
export function evaluateConstraints(
  identity: DocumentIdentity,
  slot: SlotSnapshot,
): ConstraintResult[] {
  return [
    checkSlotEmpty(slot),
    checkDocTypeMatch(identity, slot),
    checkTaxYearMatch(identity, slot),
    checkYearRequired(identity, slot),
    // v1.1: period gating
    checkYearConfidenceSufficient(identity, slot),
    checkNotMultiYear(identity, slot),
    // v1.1: entity routing
    checkEntityIdMatch(identity, slot),
    checkEntityRoleMatch(identity, slot),
  ];
}
