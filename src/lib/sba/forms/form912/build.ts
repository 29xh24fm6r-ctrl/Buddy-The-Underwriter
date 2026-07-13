import { FORM_912_FIELDS, missingRequiredFields } from "@/lib/sba/forms/form912/fields";

export type Form912PersonInput = {
  ownership_entity_id: string;
  fields: Record<string, string | number | boolean | null>;
};

export type Form912Input = {
  applicable: boolean;
  persons: Form912PersonInput[];
};

export type Form912SignatureStatus = {
  ownership_entity_id: string;
  has_valid_signature: boolean;
  signed_at: string | null;
  expires_at: string | null;
  needs_resignature: boolean;
};

export type Form912BuildResult =
  | { form: "912"; applicable: false }
  | {
      form: "912";
      applicable: true;
      input: Form912Input;
      missing: Array<{ ownership_entity_id: string; missing: string[] }>;
      is_complete: boolean;
      signatures: Form912SignatureStatus[];
    };

/**
 * SPEC S4 G-2 — conditional generator. `input.applicable` is set by the
 * caller from Form 1919's `triggers_form_912` (via
 * form912/inputBuilder.ts). When false, this returns the applicable:false
 * shape and the package builder skips Form 912 entirely — no missing-field
 * noise for a form that isn't required.
 */
export function buildForm912(input: Form912Input): Form912BuildResult {
  if (!input.applicable) {
    return { form: "912", applicable: false };
  }

  const missing = input.persons.map((p) => ({
    ownership_entity_id: p.ownership_entity_id,
    missing: missingRequiredFields(FORM_912_FIELDS, p.fields),
  }));

  const isComplete = input.persons.length > 0 && missing.every((m) => m.missing.length === 0);

  return {
    form: "912",
    applicable: true,
    input,
    missing,
    is_complete: isComplete,
    signatures: input.persons.map((p) => ({
      ownership_entity_id: p.ownership_entity_id,
      has_valid_signature: false,
      signed_at: null,
      expires_at: null,
      needs_resignature: false,
    })),
  };
}
