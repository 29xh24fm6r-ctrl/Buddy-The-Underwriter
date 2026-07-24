import {
  FORM_1919_SECTION_I_FIELDS,
  FORM_1919_SECTION_II_FIELDS,
  FORM_1919_SECTION_III_FIELDS,
  FORM_912_TRIGGER_FIELDS,
  missingRequiredFields,
} from "@/lib/sba/forms/form1919/fields";

export type Form1919SectionIInput = Record<string, string | number | boolean | null>;

export type Form1919PersonInput = {
  ownership_entity_id: string;
  fields: Record<string, string | number | boolean | null>;
};

export type Form1919EntityInput = {
  ownership_entity_id: string;
  fields: Record<string, string | number | boolean | null>;
};

export type Form1919OwnerRosterRow = {
  ownership_entity_id: string;
  name: string | null;
  title: string | null;
  percentage: number | null;
  is_individual: boolean;
  entity_ein: string | null;
  home_address: string | null;
};

export type Form1919Input = {
  sectionI: Form1919SectionIInput;
  sectionII: Form1919PersonInput[];
  sectionIII: Form1919EntityInput[];
  // Section I's up-to-5-owner summary roster — separate from Section
  // II/III's per-individual/per-entity disclosure blocks.
  ownerRoster: Form1919OwnerRosterRow[];
};

export type Form1919BuildResult = {
  form: "1919";
  input: Form1919Input;
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

export function buildForm1919(input: Form1919Input): Form1919BuildResult {
  const sectionIMissing = missingRequiredFields(FORM_1919_SECTION_I_FIELDS, input.sectionI);

  const sectionIIMissing = input.sectionII.map((person) => ({
    ownership_entity_id: person.ownership_entity_id,
    missing: missingRequiredFields(FORM_1919_SECTION_II_FIELDS, person.fields),
  }));

  const sectionIIIMissing = input.sectionIII.map((entity) => ({
    ownership_entity_id: entity.ownership_entity_id,
    missing: missingRequiredFields(FORM_1919_SECTION_III_FIELDS, entity.fields),
  }));

  const triggersForm912 = input.sectionII.some((person) => personTriggers912(person.fields));

  const isComplete =
    sectionIMissing.length === 0 &&
    sectionIIMissing.every((p) => p.missing.length === 0) &&
    sectionIIIMissing.every((e) => e.missing.length === 0);

  return {
    form: "1919",
    input,
    missing: {
      section_i: sectionIMissing,
      section_ii: sectionIIMissing,
      section_iii: sectionIIIMissing,
    },
    triggers_form_912: triggersForm912,
    is_complete: isComplete,
    // buildForm1919() stays pure — no DB call. Signature status defaults to
    // "not signed"; buildForm1919WithSignature(dealId, sb) (SPEC S3 D-2)
    // looks up the real signed_documents row and overrides this.
    signature: { has_valid_signature: false, signed_at: null, expires_at: null, needs_resignature: false },
  };
}
