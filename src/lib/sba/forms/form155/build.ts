import { FORM_155_FIELDS, missingRequiredFields } from "@/lib/sba/forms/form155/fields";

export type Form155Input = Record<string, string | number | boolean | null>;

export type Form155SignatureStatus = {
  has_valid_signature: boolean;
  signed_at: string | null;
  expires_at: string | null;
  needs_resignature: boolean;
};

export type Form155BuildResult =
  | { form: "155"; applicable: false }
  | {
      form: "155";
      applicable: true;
      input: Form155Input;
      missing: string[];
      is_complete: boolean;
      borrower_ownership_entity_id: string | null;
      /**
       * SPEC S4 G-3 gap: the standby creditor (seller) has no
       * representation in ownership_entities or deal_loan_requests — the
       * schema only carries seller_note_equity_portion/seller_note_full_standby
       * flags, not a seller identity/address. E-signature for this party
       * can't be requested through the existing signer_ownership_entity_id
       * FK until that's added. Logged in the Drift Log rather than fixed
       * here (AP-2 — out of scope for this session's schema work).
       */
      standby_creditor_signable: false;
      borrower_signature: Form155SignatureStatus;
    };

export function buildForm155(input: { applicable: boolean; fields: Form155Input; borrowerOwnershipEntityId: string | null }): Form155BuildResult {
  if (!input.applicable) {
    return { form: "155", applicable: false };
  }

  const missing = missingRequiredFields(FORM_155_FIELDS, input.fields);

  return {
    form: "155",
    applicable: true,
    input: input.fields,
    missing,
    is_complete: missing.length === 0 && input.borrowerOwnershipEntityId != null,
    borrower_ownership_entity_id: input.borrowerOwnershipEntityId,
    standby_creditor_signable: false,
    borrower_signature: { has_valid_signature: false, signed_at: null, expires_at: null, needs_resignature: false },
  };
}
