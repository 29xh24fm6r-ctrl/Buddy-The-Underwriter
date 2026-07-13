import { FORM_601_FIELDS, missingRequiredFields } from "@/lib/sba/forms/form601/fields";

export type Form601Input = Record<string, string | number | boolean | null>;

export type Form601SignatureStatus = {
  has_valid_signature: boolean;
  signed_at: string | null;
  expires_at: string | null;
  needs_resignature: boolean;
};

export type Form601BuildResult =
  | { form: "601"; applicable: false }
  | {
      form: "601";
      applicable: true;
      input: Form601Input;
      missing: string[];
      is_complete: boolean;
      borrower_ownership_entity_id: string | null;
      signature: Form601SignatureStatus;
    };

/** SPEC S7 (ARC-00 Phase 5) — conditional on construction > $10K in use of proceeds. */
export function buildForm601(input: { applicable: boolean; fields: Form601Input; borrowerOwnershipEntityId: string | null }): Form601BuildResult {
  if (!input.applicable) {
    return { form: "601", applicable: false };
  }

  const missing = missingRequiredFields(FORM_601_FIELDS, input.fields);

  return {
    form: "601",
    applicable: true,
    input: input.fields,
    missing,
    is_complete: missing.length === 0 && input.borrowerOwnershipEntityId != null,
    borrower_ownership_entity_id: input.borrowerOwnershipEntityId,
    signature: { has_valid_signature: false, signed_at: null, expires_at: null, needs_resignature: false },
  };
}
