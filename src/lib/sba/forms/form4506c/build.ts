import { FORM_4506C_SIGNER_FIELDS, FORM_4506C_THIRD_PARTY_FIELDS, missingRequiredFields } from "@/lib/sba/forms/form4506c/fields";

export type Form4506cSignerInput = {
  ownership_entity_id: string;
  // §7 (wage_income_form_numbers) and §8 (tax_periods) are each up to a
  // handful of string values — arrays, not a single scalar.
  fields: Record<string, string | number | boolean | string[] | null>;
};

export type Form4506cThirdPartyInput = Record<string, string | number | boolean | null>;

export type Form4506cInput = {
  signers: Form4506cSignerInput[];
  thirdParty: Form4506cThirdPartyInput;
};

export type Form4506cSignatureStatus = {
  ownership_entity_id: string;
  has_valid_signature: boolean;
  signed_at: string | null;
  expires_at: string | null;
  needs_resignature: boolean;
};

export type Form4506cBuildResult = {
  form: "4506C";
  input: Form4506cInput;
  missing: {
    third_party: string[];
    signers: Array<{ ownership_entity_id: string; missing: string[] }>;
  };
  is_complete: boolean;
  signatures: Form4506cSignatureStatus[];
};

export function buildForm4506c(input: Form4506cInput): Form4506cBuildResult {
  const thirdPartyMissing = missingRequiredFields(FORM_4506C_THIRD_PARTY_FIELDS, input.thirdParty);
  const signerMissing = input.signers.map((s) => ({
    ownership_entity_id: s.ownership_entity_id,
    missing: missingRequiredFields(FORM_4506C_SIGNER_FIELDS, s.fields),
  }));

  const isComplete = thirdPartyMissing.length === 0 && signerMissing.every((s) => s.missing.length === 0) && input.signers.length > 0;

  return {
    form: "4506C",
    input,
    missing: { third_party: thirdPartyMissing, signers: signerMissing },
    is_complete: isComplete,
    // buildForm4506c() stays pure — no DB call. Signature status defaults
    // to "not signed" per signer; buildForm4506cWithSignature(dealId, sb)
    // looks up real signed_documents rows and overrides this (same split
    // as form1919/buildWithSignature.ts).
    signatures: input.signers.map((s) => ({
      ownership_entity_id: s.ownership_entity_id,
      has_valid_signature: false,
      signed_at: null,
      expires_at: null,
      needs_resignature: false,
    })),
  };
}
