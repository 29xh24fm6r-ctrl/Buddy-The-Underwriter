import {
  FORM_1244_SECTION_I_FIELDS,
  FORM_1244_SECTION_II_FIELDS,
  FORM_912_TRIGGER_FIELDS,
  missingRequiredFields,
} from "@/lib/sba/forms/form1244/fields";

export type Form1244SectionIInput = Record<string, string | number | boolean | null>;

export type Form1244PersonInput = {
  ownership_entity_id: string;
  fields: Record<string, string | number | boolean | null>;
};

export type Form1244OwnerRosterRow = {
  ownership_entity_id: string;
  name: string | null;
  title: string | null;
  ssn_tin_on_file: boolean;
  ownership_pct: number | null;
};

export type Form1244Input = {
  sectionI: Form1244SectionIInput;
  isEligiblePassiveCompany: boolean;
  applicantOwnerRoster: Form1244OwnerRosterRow[];
  ocOwnerRoster: Form1244OwnerRosterRow[];
  sectionII: Form1244PersonInput[];
};

export type Form1244BuildResult = {
  form: "1244";
  input: Form1244Input;
  missing: {
    section_i: string[];
    section_ii: Array<{ ownership_entity_id: string; missing: string[] }>;
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

// Only the fields the Applicant/EPC side treats as required become
// required for the Operating Company too — dba/duns/website stay
// optional in both cases (matches FORM_1244_SECTION_I_FIELDS' own
// required flags for the Applicant/EPC equivalents).
const OC_REQUIRED_WHEN_EPC_KEYS = ["oc_legal_name", "oc_address", "oc_legal_structure", "oc_tax_id", "oc_contact_name", "oc_email", "oc_phone"];

function personTriggers912(fields: Record<string, unknown>): boolean {
  return FORM_912_TRIGGER_FIELDS.some((key) => fields[key] === true);
}

/**
 * SPEC S6 (ARC-00 Phase 4) — pure builder. Section I validated against
 * FORM_1244_SECTION_I_FIELDS, with the Operating Company sub-fields only
 * required when isEligiblePassiveCompany is true (a static field list
 * can't express that condition). Section II validated per-associate
 * against the real 5-question set.
 */
export function buildForm1244(input: Form1244Input): Form1244BuildResult {
  const sectionIFieldsForThisDeal = FORM_1244_SECTION_I_FIELDS.map((f) =>
    OC_REQUIRED_WHEN_EPC_KEYS.includes(f.key) && input.isEligiblePassiveCompany ? { ...f, required: true } : f,
  );
  const sectionIMissing = missingRequiredFields(sectionIFieldsForThisDeal, input.sectionI);

  const sectionIIMissing = input.sectionII.map((person) => ({
    ownership_entity_id: person.ownership_entity_id,
    missing: missingRequiredFields(FORM_1244_SECTION_II_FIELDS, person.fields),
  }));

  const triggersForm912 = input.sectionII.some((person) => personTriggers912(person.fields));

  const isComplete = sectionIMissing.length === 0 && sectionIIMissing.every((p) => p.missing.length === 0);

  return {
    form: "1244",
    input,
    missing: {
      section_i: sectionIMissing,
      section_ii: sectionIIMissing,
    },
    triggers_form_912: triggersForm912,
    is_complete: isComplete,
    signature: { has_valid_signature: false, signed_at: null, expires_at: null, needs_resignature: false },
  };
}
