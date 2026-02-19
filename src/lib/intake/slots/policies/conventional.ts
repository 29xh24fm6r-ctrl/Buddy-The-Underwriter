// ---------------------------------------------------------------------------
// Phase 15B — Conventional Slot Policy (Baseline)
// ---------------------------------------------------------------------------
// Returns the same 11 slots as Phase 15 for non-SBA deals.
// Multi-entity extension: when entities are provided, generates per-entity
// PFS/PTR/BTR slots. Single-entity deals are unchanged (all null, backward compat).

import type { IntakeScenario, SlotDefinition, SlotPolicy } from "../types";
import { computeTaxYears } from "../taxYears";

// ---------------------------------------------------------------------------
// Entity input (optional — not imported from entity resolver to avoid coupling)
// ---------------------------------------------------------------------------

export type SlotEntityHint = {
  entityId: string;
  entityRole: "borrower" | "guarantor" | "operating" | "holding";
  legalName: string;
};

// ---------------------------------------------------------------------------
// Slot generation
// ---------------------------------------------------------------------------

export function generateConventionalSlots(
  _scenario: IntakeScenario,
  now?: Date,
  entities?: SlotEntityHint[],
): SlotDefinition[] {
  const taxYears = computeTaxYears(now);
  const slots: SlotDefinition[] = [];
  let s = 0;

  const guarantors = entities?.filter((e) => e.entityRole === "guarantor") ?? [];
  const bizEntities = entities?.filter((e) =>
    e.entityRole === "operating" || e.entityRole === "holding",
  ) ?? [];
  const hasMultipleGuarantors = guarantors.length > 1;
  const hasMultipleBizEntities = bizEntities.length > 1;

  // 3 Business Tax Returns (per entity when multiple biz entities)
  if (hasMultipleBizEntities) {
    for (const ent of bizEntities) {
      const suffix = ent.legalName
        .replace(/[^a-zA-Z0-9]/g, "_")
        .toUpperCase()
        .slice(0, 20);
      for (const year of taxYears) {
        slots.push({
          slot_key: `BUSINESS_TAX_RETURN_${year}_${suffix}`,
          slot_group: "BUSINESS_TAX_RETURN",
          required_doc_type: "BUSINESS_TAX_RETURN",
          required_tax_year: year,
          required: true,
          sort_order: s++,
          slot_mode: "UPLOAD",
          interactive_kind: null,
          required_entity_id: ent.entityId,
          required_entity_role: ent.entityRole,
        });
      }
    }
  } else {
    for (const year of taxYears) {
      slots.push({
        slot_key: `BUSINESS_TAX_RETURN_${year}`,
        slot_group: "BUSINESS_TAX_RETURN",
        required_doc_type: "BUSINESS_TAX_RETURN",
        required_tax_year: year,
        required: true,
        sort_order: s++,
        slot_mode: "UPLOAD",
        interactive_kind: null,
      });
    }
  }

  // 3 Personal Tax Returns (per guarantor when multiple)
  if (hasMultipleGuarantors) {
    for (const guar of guarantors) {
      const suffix = guar.legalName
        .replace(/[^a-zA-Z0-9]/g, "_")
        .toUpperCase()
        .slice(0, 20);
      for (const year of taxYears) {
        slots.push({
          slot_key: `PERSONAL_TAX_RETURN_${year}_${suffix}`,
          slot_group: "PERSONAL_TAX_RETURN",
          required_doc_type: "PERSONAL_TAX_RETURN",
          required_tax_year: year,
          required: true,
          sort_order: s++,
          slot_mode: "UPLOAD",
          interactive_kind: null,
          required_entity_id: guar.entityId,
          required_entity_role: guar.entityRole,
        });
      }
    }
  } else {
    for (const year of taxYears) {
      slots.push({
        slot_key: `PERSONAL_TAX_RETURN_${year}`,
        slot_group: "PERSONAL_TAX_RETURN",
        required_doc_type: "PERSONAL_TAX_RETURN",
        required_tax_year: year,
        required: true,
        sort_order: s++,
        slot_mode: "UPLOAD",
        interactive_kind: null,
      });
    }
  }

  // PFS (per guarantor when multiple)
  if (hasMultipleGuarantors) {
    for (const guar of guarantors) {
      const suffix = guar.legalName
        .replace(/[^a-zA-Z0-9]/g, "_")
        .toUpperCase()
        .slice(0, 20);
      slots.push({
        slot_key: `PFS_${suffix}`,
        slot_group: "PFS",
        required_doc_type: "PERSONAL_FINANCIAL_STATEMENT",
        required_tax_year: null,
        required: true,
        sort_order: s++,
        slot_mode: "UPLOAD",
        interactive_kind: null,
        required_entity_id: guar.entityId,
        required_entity_role: guar.entityRole,
      });
    }
  } else {
    slots.push({
      slot_key: "PFS_CURRENT",
      slot_group: "PFS",
      required_doc_type: "PERSONAL_FINANCIAL_STATEMENT",
      required_tax_year: null,
      required: true,
      sort_order: s++,
      slot_mode: "UPLOAD",
      interactive_kind: null,
    });
  }

  // YTD Income Statement
  slots.push({
    slot_key: "INCOME_STATEMENT_YTD",
    slot_group: "INCOME_STATEMENT",
    required_doc_type: "INCOME_STATEMENT",
    required_tax_year: null,
    required: true,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
  });

  // Current Balance Sheet
  slots.push({
    slot_key: "BALANCE_SHEET_CURRENT",
    slot_group: "BALANCE_SHEET",
    required_doc_type: "BALANCE_SHEET",
    required_tax_year: null,
    required: true,
    sort_order: s++,
    slot_mode: "UPLOAD",
    interactive_kind: null,
  });

  return slots;
}

export const CONVENTIONAL_POLICY: SlotPolicy = {
  product: "CONVENTIONAL",
  generateSlots: generateConventionalSlots,
};
