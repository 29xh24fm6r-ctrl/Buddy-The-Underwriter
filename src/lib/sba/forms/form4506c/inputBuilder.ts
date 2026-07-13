import type { Form4506cInput } from "@/lib/sba/forms/form4506c/build";

export type Form4506cInputBuilderClient = { from: (table: string) => any };

function isIndividual(entityType: string | null | undefined): boolean {
  return entityType === "individual" || entityType === "person";
}

/**
 * SPEC S4 D-1 — assembles Form4506cInput from canonical state. One signer
 * per individual owner (business-entity self-filed returns are a real gap
 * — not built here; flagged in the Drift Log, same judgment boundary as
 * the "ownership_entities has no full-SSN column" gap elsewhere in this
 * arc). Third-party recipient = the lender bank; `banks` has no address
 * columns in prod (confirmed via information_schema, same finding already
 * logged for `lender_is_federally_regulated` in dealDataBuilder.ts), so
 * recipient_address/phone are null until that's added.
 */
export async function buildForm4506cInput(dealId: string, bankId: string, sb: Form4506cInputBuilderClient): Promise<Form4506cInput> {
  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select("id, entity_type, display_name, tax_id_last4, home_address_street, home_address_city, home_address_state, home_address_zip")
    .eq("deal_id", dealId);

  const { data: bank } = await sb.from("banks").select("name").eq("id", bankId).maybeSingle();

  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select("tax_years")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const taxYears = (loanRequest as { tax_years?: string } | null)?.tax_years ?? null;

  const signers: Form4506cInput["signers"] = (ownershipEntities ?? [])
    .filter((e: any) => isIndividual(e.entity_type))
    .map((e: any) => ({
      ownership_entity_id: String(e.id),
      fields: {
        taxpayer_name: e.display_name ?? null,
        taxpayer_id: e.tax_id_last4 ?? null,
        spouse_name: null,
        spouse_id: null,
        current_address_street: e.home_address_street ?? null,
        current_address_city: e.home_address_city ?? null,
        current_address_state: e.home_address_state ?? null,
        current_address_zip: e.home_address_zip ?? null,
        previous_address_street: null,
        transcript_type_return: true,
        transcript_type_account: true,
        transcript_type_wage_income: true,
        transcript_type_verification_nonfiling: false,
        tax_form_numbers: "1040",
        tax_years: taxYears,
      },
    }));

  return {
    signers,
    thirdParty: {
      recipient_name: (bank as { name?: string } | null)?.name ?? null,
      recipient_address: null,
      recipient_phone: null,
    },
  };
}
