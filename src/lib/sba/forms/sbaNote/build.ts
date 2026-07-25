import {
  SBA_NOTE_FIELDS,
  missingRequiredFields,
  standardLateChargeText,
  standardPrepaymentPenaltyText,
} from "@/lib/sba/forms/sbaNote/fields";

export type SbaNoteInput = {
  borrower_legal_name: string | null;
  lender_name: string | null;
  lender_address: string | null;
  principal_amount: number | null;
  interest_rate_pct: number | null;
  rate_type: "fixed" | "variable" | null;
  rate_index: string | null;
  rate_spread_bps: number | null;
  term_months: number | null;
  amort_months: number | null;
  interest_only_months: number | null;
  payment_frequency: string | null;
  use_of_proceeds_summary: string | null;
  late_charge_text: string;
  prepayment_penalty_text: string;
  collateral_summary: string[];
  guarantors: Array<{ name: string; type: string | null }>;
};

export type SbaNoteSignatureStatus = {
  has_valid_signature: boolean;
  signed_at: string | null;
  expires_at: string | null;
  needs_resignature: boolean;
};

export type SbaNoteLegalReviewStatus = {
  approved: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

export type SbaNoteBuildResult = {
  form: "sba_note";
  input: SbaNoteInput;
  missing: string[];
  is_complete: boolean;
  borrower_ownership_entity_id: string | null;
  signature: SbaNoteSignatureStatus;
  legal_review: SbaNoteLegalReviewStatus;
};

export function buildSbaNote(input: {
  fields: Omit<SbaNoteInput, "late_charge_text" | "prepayment_penalty_text">;
  lateChargeOverrideText: string | null;
  prepaymentPenaltyOverrideText: string | null;
  borrowerOwnershipEntityId: string | null;
}): SbaNoteBuildResult {
  const noteInput: SbaNoteInput = {
    ...input.fields,
    late_charge_text: input.lateChargeOverrideText?.trim() || standardLateChargeText(),
    prepayment_penalty_text: input.prepaymentPenaltyOverrideText?.trim() || standardPrepaymentPenaltyText(input.fields.term_months),
  };

  const missing = missingRequiredFields(SBA_NOTE_FIELDS, noteInput as unknown as Record<string, unknown>);

  return {
    form: "sba_note",
    input: noteInput,
    missing,
    is_complete: missing.length === 0 && input.borrowerOwnershipEntityId != null,
    borrower_ownership_entity_id: input.borrowerOwnershipEntityId,
    signature: { has_valid_signature: false, signed_at: null, expires_at: null, needs_resignature: false },
    legal_review: { approved: false, reviewed_by: null, reviewed_at: null },
  };
}
