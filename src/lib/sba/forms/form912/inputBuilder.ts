import type { Form912Input } from "@/lib/sba/forms/form912/build";
import { buildForm1919Input, type Form1919InputBuilderClient } from "@/lib/sba/forms/form1919/inputBuilder";
import { buildForm1244Input } from "@/lib/sba/forms/form1244/inputBuilder";
import { FORM_912_TRIGGER_FIELDS } from "@/lib/sba/forms/form1919/fields";

export type Form912InputBuilderClient = Form1919InputBuilderClient;

function personTriggers912(fields: Record<string, unknown>): boolean {
  return FORM_912_TRIGGER_FIELDS.some((key) => fields[key] === true);
}

/**
 * SPEC S4 G-2 / ARC-00 A-S4-3 (504 parity) — recomputes which owners
 * trigger Form 912 straight from Section II answers on *both* Form 1919
 * (7a) and Form 1244 (504), not a stored flag — keeps this in sync with
 * either program's current answers rather than a snapshot that could go
 * stale. A deal only has one program's loan-request row in practice, but
 * checking both is cheap and means this function doesn't need to know
 * which program the deal is before deciding whether 912 applies.
 *
 * Field set rewritten against the real current-revision PDF (see
 * fields.ts / pdfFieldMap.ts / docs/sba-forms/912-fields.json): full SSN
 * presence (not the value — that's decrypted only at render time, see
 * render.ts), ownership percentage, and the form's actual 3 yes/no
 * questions, one of which (incarcerated/indicted) is the same disclosure
 * as 1919 Section II Q4 and shares a column with it.
 */
export async function buildForm912Input(
  dealId: string,
  sb: Form912InputBuilderClient,
): Promise<Form912Input> {
  const [form1919Input, form1244Input] = await Promise.all([
    buildForm1919Input(dealId, sb),
    buildForm1244Input(dealId, sb),
  ]);

  const triggeringIds = new Set([
    ...form1919Input.sectionII.filter((p) => personTriggers912(p.fields)).map((p) => p.ownership_entity_id),
    ...form1244Input.sectionII.filter((p) => personTriggers912(p.fields)).map((p) => p.ownership_entity_id),
  ]);

  if (triggeringIds.size === 0) {
    return { applicable: false, persons: [] };
  }

  const { data: deal } = await sb.from("deals").select("borrower_id").eq("id", dealId).maybeSingle();
  const borrowerId = (deal as { borrower_id?: string } | null)?.borrower_id ?? null;
  const { data: borrower } = borrowerId
    ? await sb.from("borrowers").select("legal_name, address_line1, city, state, zip, primary_contact_email").eq("id", borrowerId).maybeSingle()
    : { data: null };
  const b = borrower as Record<string, any> | null;
  const businessNameAddressEmail = b
    ? [b.legal_name, [b.address_line1, b.city, b.state, b.zip].filter(Boolean).join(", "), b.primary_contact_email]
        .filter(Boolean)
        .join("; ") || null
    : null;

  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select(
      "id, display_name, tax_id_last4, ownership_pct, title, date_of_birth, place_of_birth, citizenship_status, " +
        "alien_registration_number, home_phone, business_phone, " +
        "home_address_street, home_address_city, home_address_state, home_address_zip, " +
        "prior_address_street, prior_address_city, prior_address_state, prior_address_zip, " +
        "incarcerated_or_indicted_financial_crime, riot_related_conviction_past_year, delinquent_child_support_60days, " +
        "evidence_json",
    )
    .eq("deal_id", dealId);

  const entities = (ownershipEntities ?? []) as Array<Record<string, any>>;

  const persons: Form912Input["persons"] = [];
  for (const e of entities) {
    if (!triggeringIds.has(String(e.id))) continue;
    const evidence = (e.evidence_json ?? {}) as Record<string, any>;

    const { data: piiRows } = await sb
      .from("deal_pii_records")
      .select("pii_type")
      .eq("deal_id", dealId)
      .eq("ownership_entity_id", e.id)
      .eq("pii_type", "full_ssn");
    const ssnOnFile = ((piiRows ?? []) as Array<{ pii_type: string }>).length > 0;

    persons.push({
      ownership_entity_id: String(e.id),
      fields: {
        business_name_address_email: businessNameAddressEmail,
        full_name: e.display_name ?? null,
        all_other_names_used: evidence.all_other_names_used ?? null,
        ownership_percentage: e.ownership_pct ?? null,
        // Presence marker only — never the plaintext value. The real SSN
        // is decrypted exclusively inside render.ts at fill time.
        full_ssn: ssnOnFile ? "on_file" : null,
        date_of_birth: e.date_of_birth ?? evidence.date_of_birth ?? null,
        place_of_birth: e.place_of_birth ?? evidence.place_of_birth ?? null,
        is_us_citizen: e.citizenship_status ? e.citizenship_status === "us_citizen" : null,
        alien_registration_number: e.alien_registration_number ?? evidence.alien_registration_number ?? null,
        current_address_street: e.home_address_street ?? evidence.home_address_street ?? null,
        current_address_city: e.home_address_city ?? evidence.home_address_city ?? null,
        current_address_state: e.home_address_state ?? evidence.home_address_state ?? null,
        current_address_zip: e.home_address_zip ?? evidence.home_address_zip ?? null,
        home_phone: e.home_phone ?? evidence.home_phone ?? null,
        business_phone: e.business_phone ?? evidence.business_phone ?? null,
        prior_address_street: e.prior_address_street ?? null,
        prior_address_city: e.prior_address_city ?? null,
        prior_address_state: e.prior_address_state ?? null,
        prior_address_zip: e.prior_address_zip ?? null,
        signer_title: e.title ?? null,
        incarcerated_or_indicted_financial_crime: e.incarcerated_or_indicted_financial_crime ?? null,
        riot_related_conviction_past_year: e.riot_related_conviction_past_year ?? null,
        delinquent_child_support_60days: e.delinquent_child_support_60days ?? null,
      },
    });
  }

  return { applicable: true, persons };
}
