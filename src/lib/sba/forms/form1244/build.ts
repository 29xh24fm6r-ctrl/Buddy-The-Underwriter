import {
  FORM_1244_SECTION_I_FIELDS,
  FORM_1244_SECTION_II_FIELDS,
  FORM_1244_SECTION_III_FIELDS,
  FORM_912_TRIGGER_FIELDS,
  missingRequiredFields,
} from "@/lib/sba/forms/form1244/fields";

export type Form1244SectionIInput = Record<string, string | number | boolean | null>;

export type Form1244PersonInput = {
  ownership_entity_id: string;
  fields: Record<string, string | number | boolean | null>;
};

export type Form1244EntityInput = {
  ownership_entity_id: string;
  fields: Record<string, string | number | boolean | null>;
};

export type Form1244Input = {
  sectionI: Form1244SectionIInput;
  sectionII: Form1244PersonInput[];
  sectionIII: Form1244EntityInput[];
};

export type Form1244BuildResult = {
  form: "1244";
  input: Form1244Input;
  missing: {
    section_i: string[];
    section_ii: Array<{ ownership_entity_id: string; missing: string[] }>;
    section_iii: Array<{ ownership_entity_id: string; missing: string[] }>;
  };
  triggers_form_912: boolean;
  is_complete: boolean;
  signature: {
    has_valid_signature: boolean;
    signed_at: string | null;
    expires_at: string | null;
    needs_resignature: boolean;
  };
};

function personTriggers912(fields: Record<string, unknown>): boolean {
  return FORM_912_TRIGGER_FIELDS.some((key) => fields[key] === true);
}

/**
 * SPEC S6 (ARC-00 Phase 4) — pure builder, same shape/contract as
 * buildForm1919(): Section I (project/business) validated against
 * FORM_1244_SECTION_I_FIELDS; Section II/III reuse 1919's field sets
 * (A-S4-3 parity — same personal-history questions, same Form 912
 * trigger).
 */
export function buildForm1244(input: Form1244Input): Form1244BuildResult {
  const sectionIMissing = missingRequiredFields(FORM_1244_SECTION_I_FIELDS, input.sectionI);

  const sectionIIMissing = input.sectionII.map((person) => ({
    ownership_entity_id: person.ownership_entity_id,
    missing: missingRequiredFields(FORM_1244_SECTION_II_FIELDS, person.fields),
  }));

  const sectionIIIMissing = input.sectionIII.map((entity) => ({
    ownership_entity_id: entity.ownership_entity_id,
    missing: missingRequiredFields(FORM_1244_SECTION_III_FIELDS, entity.fields),
  }));

  const triggersForm912 = input.sectionII.some((person) => personTriggers912(person.fields));

  const isComplete =
    sectionIMissing.length === 0 &&
    sectionIIMissing.every((p) => p.missing.length === 0) &&
    sectionIIIMissing.every((e) => e.missing.length === 0);

  return {
    form: "1244",
    input,
    missing: {
      section_i: sectionIMissing,
      section_ii: sectionIIMissing,
      section_iii: sectionIIIMissing,
    },
    triggers_form_912: triggersForm912,
    is_complete: isComplete,
    signature: { has_valid_signature: false, signed_at: null, expires_at: null, needs_resignature: false },
  };
}
