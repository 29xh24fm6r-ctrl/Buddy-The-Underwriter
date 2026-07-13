import type { Form413Input } from "@/lib/sba/forms/form413/build";

export type Form413InputBuilderClient = { from: (table: string) => any };

function isIndividual(entityType: string | null | undefined): boolean {
  return entityType === "individual" || entityType === "person";
}

/**
 * SPEC S2 E — assembles Form413Input, one signer per 20%+ owner. Sources
 * identity/address from ownership_entities, financial summary figures
 * (fico/liquid_assets/net_worth) from borrower_applicant_financials
 * (migration 20260425) when present — that table is a summary, not a full
 * ~50-field PFS breakdown, so most asset/liability line items are
 * genuinely unavailable today and correctly surface via `missing` rather
 * than being invented.
 */
export async function buildForm413Input(
  dealId: string,
  sb: Form413InputBuilderClient,
): Promise<Form413Input> {
  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select(
      "id, entity_type, display_name, tax_id_last4, ownership_pct, date_of_birth, " +
        "home_address_street, home_address_city, home_address_state, home_address_zip, evidence_json",
    )
    .eq("deal_id", dealId);

  const owners = ((ownershipEntities ?? []) as Array<Record<string, any>>).filter(
    (e) => isIndividual(e.entity_type) && (e.ownership_pct ?? 0) >= 20,
  );

  const signers: Form413Input["signers"] = [];
  for (const owner of owners) {
    const evidence = (owner.evidence_json ?? {}) as Record<string, any>;

    const { data: financials } = await sb
      .from("borrower_applicant_financials")
      .select("net_worth, liquid_assets, captured_at")
      .eq("applicant_id", owner.id)
      .maybeSingle();

    const f = (financials ?? {}) as { net_worth?: number; liquid_assets?: number; captured_at?: string };

    signers.push({
      ownership_entity_id: String(owner.id),
      fields: {
        full_name: owner.display_name ?? null,
        address_street: owner.home_address_street ?? evidence.home_address_street ?? null,
        address_city: owner.home_address_city ?? evidence.home_address_city ?? null,
        address_state: owner.home_address_state ?? evidence.home_address_state ?? null,
        address_zip: owner.home_address_zip ?? evidence.home_address_zip ?? null,
        business_phone: null,
        home_phone: evidence.home_phone ?? null,
        ssn_last4: owner.tax_id_last4 ?? null,
        date_of_birth: owner.date_of_birth ?? evidence.date_of_birth ?? null,
        business_name: null,

        asset_cash_on_hand_and_in_banks: f.liquid_assets ?? null,
        asset_total: null,
        liability_total: null,
        net_worth: f.net_worth ?? null,

        signed_at: null,
        has_spouse: evidence.has_spouse ?? null,
        spouse_full_name: evidence.spouse_full_name ?? null,
      },
    });
  }

  return { signers };
}
