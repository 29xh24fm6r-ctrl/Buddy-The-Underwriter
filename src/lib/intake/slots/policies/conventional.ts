// ---------------------------------------------------------------------------
// Phase 15B — Conventional Slot Policy (Baseline)
// ---------------------------------------------------------------------------
// Returns the same 11 slots as Phase 15 for non-SBA deals.

import type { IntakeScenario, SlotDefinition, SlotPolicy } from "../types";
import { computeTaxYears } from "../taxYears";

export function generateConventionalSlots(
  _scenario: IntakeScenario,
  now?: Date,
): SlotDefinition[] {
  const taxYears = computeTaxYears(now);
  const slots: SlotDefinition[] = [];
  let s = 0;

  // 3 Business Tax Returns
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

  // 3 Personal Tax Returns
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

  // PFS
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
