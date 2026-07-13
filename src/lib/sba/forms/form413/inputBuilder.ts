import type { Form413Input } from "@/lib/sba/forms/form413/build";

export type Form413InputBuilderClient = { from: (table: string) => any };

function isIndividual(entityType: string | null | undefined): boolean {
  return entityType === "individual" || entityType === "person";
}

/** Sums a set of possibly-null line items; returns null if every one is unset. */
function sumOrNull(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => typeof v === "number");
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
}

/**
 * SPEC S2 E (extended by Arc 7) — assembles Form413Input, one signer per
 * 20%+ owner. Identity/address from ownership_entities; the full itemized
 * PFS breakdown (assets/liabilities/contingent liabilities/income/REO) from
 * borrower_applicant_financials, which Arc 7's migration extended beyond
 * the original net_worth/liquid_assets summary. asset_total/liability_total
 * are derived by summing the itemized lines rather than asked directly —
 * they surface as complete once their components are known.
 */
export async function buildForm413Input(
  dealId: string,
  sb: Form413InputBuilderClient,
): Promise<Form413Input> {
  const { data: deal } = await sb.from("deals").select("borrower_id").eq("id", dealId).maybeSingle();
  const borrowerId = (deal as { borrower_id?: string } | null)?.borrower_id ?? null;
  const { data: borrower } = borrowerId
    ? await sb.from("borrowers").select("legal_name, phone").eq("id", borrowerId).maybeSingle()
    : { data: null };
  const businessName = (borrower as { legal_name?: string } | null)?.legal_name ?? null;
  const businessPhone = (borrower as { phone?: string } | null)?.phone ?? null;

  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select(
      "id, entity_type, display_name, tax_id_last4, ownership_pct, date_of_birth, home_phone, " +
        "business_phone, has_spouse, spouse_full_name, " +
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
      .select(
        "net_worth, liquid_assets, asset_savings_accounts, asset_ira_retirement, " +
          "asset_accounts_notes_receivable, asset_life_insurance_csv, asset_stocks_bonds, asset_real_estate, " +
          "asset_automobile, asset_other_personal_property, asset_other, liability_accounts_payable, " +
          "liability_notes_payable_banks_others, liability_installment_auto, liability_installment_other, " +
          "liability_loan_on_life_insurance, liability_mortgages_on_real_estate, liability_unpaid_taxes, " +
          "liability_other, contingent_as_endorser_or_comaker, contingent_legal_claims_judgments, " +
          "contingent_provision_for_federal_income_tax, contingent_other_special_debt, income_salary, " +
          "income_net_investment, income_real_estate, income_other, income_other_description, " +
          "real_estate_property_address, real_estate_type_title, real_estate_original_cost, " +
          "real_estate_present_market_value, real_estate_amount_of_mortgage",
      )
      .eq("applicant_id", owner.id)
      .maybeSingle();

    const f = (financials ?? {}) as Record<string, number | string | null | undefined>;

    const assetTotal = sumOrNull([
      f.liquid_assets as number | null,
      f.asset_savings_accounts as number | null,
      f.asset_ira_retirement as number | null,
      f.asset_accounts_notes_receivable as number | null,
      f.asset_life_insurance_csv as number | null,
      f.asset_stocks_bonds as number | null,
      f.asset_real_estate as number | null,
      f.asset_automobile as number | null,
      f.asset_other_personal_property as number | null,
      f.asset_other as number | null,
    ]);
    const liabilityTotal = sumOrNull([
      f.liability_accounts_payable as number | null,
      f.liability_notes_payable_banks_others as number | null,
      f.liability_installment_auto as number | null,
      f.liability_installment_other as number | null,
      f.liability_loan_on_life_insurance as number | null,
      f.liability_mortgages_on_real_estate as number | null,
      f.liability_unpaid_taxes as number | null,
      f.liability_other as number | null,
    ]);

    signers.push({
      ownership_entity_id: String(owner.id),
      fields: {
        full_name: owner.display_name ?? null,
        address_street: owner.home_address_street ?? evidence.home_address_street ?? null,
        address_city: owner.home_address_city ?? evidence.home_address_city ?? null,
        address_state: owner.home_address_state ?? evidence.home_address_state ?? null,
        address_zip: owner.home_address_zip ?? evidence.home_address_zip ?? null,
        business_phone: owner.business_phone ?? businessPhone ?? null,
        home_phone: owner.home_phone ?? evidence.home_phone ?? null,
        ssn_last4: owner.tax_id_last4 ?? null,
        date_of_birth: owner.date_of_birth ?? evidence.date_of_birth ?? null,
        business_name: businessName,

        asset_cash_on_hand_and_in_banks: f.liquid_assets ?? null,
        asset_savings_accounts: f.asset_savings_accounts ?? null,
        asset_ira_retirement: f.asset_ira_retirement ?? null,
        asset_accounts_notes_receivable: f.asset_accounts_notes_receivable ?? null,
        asset_life_insurance_cash_surrender_value: f.asset_life_insurance_csv ?? null,
        asset_stocks_bonds: f.asset_stocks_bonds ?? null,
        asset_real_estate: f.asset_real_estate ?? null,
        asset_automobile: f.asset_automobile ?? null,
        asset_other_personal_property: f.asset_other_personal_property ?? null,
        asset_other: f.asset_other ?? null,
        asset_total: assetTotal,

        liability_accounts_payable: f.liability_accounts_payable ?? null,
        liability_notes_payable_banks_others: f.liability_notes_payable_banks_others ?? null,
        liability_installment_auto: f.liability_installment_auto ?? null,
        liability_installment_other: f.liability_installment_other ?? null,
        liability_loan_on_life_insurance: f.liability_loan_on_life_insurance ?? null,
        liability_mortgages_on_real_estate: f.liability_mortgages_on_real_estate ?? null,
        liability_unpaid_taxes: f.liability_unpaid_taxes ?? null,
        liability_other: f.liability_other ?? null,
        liability_total: liabilityTotal,
        net_worth: f.net_worth ?? null,

        contingent_as_endorser_or_comaker: f.contingent_as_endorser_or_comaker ?? null,
        contingent_legal_claims_judgments: f.contingent_legal_claims_judgments ?? null,
        contingent_provision_for_federal_income_tax: f.contingent_provision_for_federal_income_tax ?? null,
        contingent_other_special_debt: f.contingent_other_special_debt ?? null,

        income_salary: f.income_salary ?? null,
        income_net_investment: f.income_net_investment ?? null,
        income_real_estate: f.income_real_estate ?? null,
        income_other: f.income_other ?? null,
        income_other_description: f.income_other_description ?? null,

        real_estate_property_address: f.real_estate_property_address ?? null,
        real_estate_type_title: f.real_estate_type_title ?? null,
        real_estate_original_cost: f.real_estate_original_cost ?? null,
        real_estate_present_market_value: f.real_estate_present_market_value ?? null,
        real_estate_amount_of_mortgage: f.real_estate_amount_of_mortgage ?? null,

        signed_at: null,
        has_spouse: owner.has_spouse ?? evidence.has_spouse ?? null,
        spouse_full_name: owner.spouse_full_name ?? evidence.spouse_full_name ?? null,
      },
    });
  }

  return { signers };
}
