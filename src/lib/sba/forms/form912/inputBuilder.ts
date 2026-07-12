import type { Form912Input } from "@/lib/sba/forms/form912/build";
import { buildForm1919Input, type Form1919InputBuilderClient } from "@/lib/sba/forms/form1919/inputBuilder";
import { FORM_912_TRIGGER_FIELDS } from "@/lib/sba/forms/form1919/fields";

export type Form912InputBuilderClient = Form1919InputBuilderClient;

function personTriggers912(fields: Record<string, unknown>): boolean {
  return FORM_912_TRIGGER_FIELDS.some((key) => fields[key] === true);
}

/**
 * SPEC S4 G-2 — recomputes which owners trigger Form 912 straight from
 * Form 1919's Section II answers (buildForm1919Input, not a stored flag —
 * keeps this in sync with 1919's current answers rather than a snapshot
 * that could go stale) and, for each triggering person, assembles their
 * Form 912 fields from ownership_entities.evidence_json (same source 1919
 * Section II reads from — Form 912 asks for a superset of narrative detail
 * 1919's yes/no checkboxes don't carry, so most fields here start null
 * pending banker/borrower input regardless of 1919 completeness).
 */
export async function buildForm912Input(dealId: string, sb: Form912InputBuilderClient): Promise<Form912Input> {
  const form1919Input = await buildForm1919Input(dealId, sb);

  const triggeringIds = new Set(
    form1919Input.sectionII.filter((p) => personTriggers912(p.fields)).map((p) => p.ownership_entity_id),
  );

  if (triggeringIds.size === 0) {
    return { applicable: false, persons: [] };
  }

  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select("id, display_name, tax_id_last4, date_of_birth, place_of_birth, citizenship_status, home_address_street, home_address_city, home_address_state, home_address_zip, evidence_json")
    .eq("deal_id", dealId);

  const entities = (ownershipEntities ?? []) as Array<Record<string, any>>;

  const persons: Form912Input["persons"] = entities
    .filter((e) => triggeringIds.has(String(e.id)))
    .map((e) => {
      const evidence = (e.evidence_json ?? {}) as Record<string, any>;
      return {
        ownership_entity_id: String(e.id),
        fields: {
          full_name: e.display_name ?? null,
          all_other_names_used: evidence.all_other_names_used ?? null,
          date_of_birth: e.date_of_birth ?? evidence.date_of_birth ?? null,
          place_of_birth: e.place_of_birth ?? evidence.place_of_birth ?? null,
          ssn_last4: e.tax_id_last4 ?? null,
          citizenship_status: e.citizenship_status ?? null,
          current_address_street: e.home_address_street ?? null,
          current_address_city: e.home_address_city ?? null,
          current_address_state: e.home_address_state ?? null,
          current_address_zip: e.home_address_zip ?? null,
          residence_history_5yr: evidence.residence_history_5yr ?? null,
          arrest_or_charge_explanation: evidence.arrest_or_charge_explanation ?? null,
          conviction_explanation: evidence.conviction_explanation ?? null,
          indictment_explanation: evidence.indictment_explanation ?? null,
          parole_probation_explanation: evidence.parole_probation_explanation ?? null,
        },
      };
    });

  return { applicable: true, persons };
}
