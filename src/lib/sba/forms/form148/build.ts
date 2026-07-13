import { FORM_148_SIGNER_FIELDS, missingRequiredFields } from "@/lib/sba/forms/form148/fields";
import type { GuaranteeType } from "@/lib/ownership/rules";

export type Form148SignerInput = {
  ownership_entity_id: string;
  guaranteeType: Exclude<GuaranteeType, null>;
  fields: Record<string, string | number | boolean | null>;
};

export type Form148Input = {
  signers: Form148SignerInput[];
};

export type Form148SignatureStatus = {
  ownership_entity_id: string;
  guaranteeType: Exclude<GuaranteeType, null>;
  has_valid_signature: boolean;
  signed_at: string | null;
  expires_at: string | null;
  needs_resignature: boolean;
};

export type Form148BuildResult = {
  form: "148";
  input: Form148Input;
  missing: Array<{ ownership_entity_id: string; guaranteeType: Exclude<GuaranteeType, null>; missing: string[] }>;
  is_complete: boolean;
  signatures: Form148SignatureStatus[];
};

export function buildForm148(input: Form148Input): Form148BuildResult {
  const missing = input.signers.map((s) => {
    const baseMissing = missingRequiredFields(FORM_148_SIGNER_FIELDS, s.fields);
    const capMissing = s.guaranteeType === "limited" && s.fields.limited_guarantee_cap_amount == null ? ["limited_guarantee_cap_amount"] : [];
    return { ownership_entity_id: s.ownership_entity_id, guaranteeType: s.guaranteeType, missing: [...baseMissing, ...capMissing] };
  });

  const isComplete = input.signers.length > 0 && missing.every((m) => m.missing.length === 0);

  return {
    form: "148",
    input,
    missing,
    is_complete: isComplete,
    signatures: input.signers.map((s) => ({
      ownership_entity_id: s.ownership_entity_id,
      guaranteeType: s.guaranteeType,
      has_valid_signature: false,
      signed_at: null,
      expires_at: null,
      needs_resignature: false,
    })),
  };
}
