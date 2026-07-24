import type { Form1919Input } from "@/lib/sba/forms/form1919/build";

export type Form1919InputBuilderClient = { from: (table: string) => any };

function isIndividual(entityType: string | null | undefined): boolean {
  return entityType === "individual" || entityType === "person";
}

function isEquityEntity(entityType: string | null | undefined): boolean {
  return ["corporation", "llc", "partnership", "trust"].includes(entityType ?? "");
}

/**
 * SPEC S2 D-3 — assembles Form1919Input from canonical state.
 *   Section I  <- deals + deal_loan_requests + borrowers + franchise_brands
 *   Section II <- ownership_entities where entity_type='individual'
 *   Section III<- ownership_entities where entity_type IN (corp/llc/partnership/trust)
 *
 * Field set rewritten against the real current-revision PDF (see
 * fields.ts / pdfFieldMap.ts). Full SSN presence (not the value — see
 * render.ts) replaces the old last-4 model; the 4 old Section I booleans
 * are gone (they didn't correspond to any real question on this
 * revision); Section II now carries the 13 real yes/no questions,
 * demographics, and export-sales sub-section, matching the real form's
 * per-individual structure.
 *
 * Sequential queries only (no join syntax without confirmed FK).
 */
export async function buildForm1919Input(
  dealId: string,
  sb: Form1919InputBuilderClient,
): Promise<Form1919Input> {
  const { data: deal } = await sb
    .from("deals")
    .select("id, deal_type, loan_amount, borrower_id")
    .eq("id", dealId)
    .maybeSingle();

  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select("requested_amount, use_of_proceeds, franchise_brand_id, purpose, loan_purpose, purpose_category, jobs_created_count, jobs_retained_count")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const borrowerId = (deal as { borrower_id?: string } | null)?.borrower_id ?? null;
  const { data: borrower } = borrowerId
    ? await sb
        .from("borrowers")
        .select(
          "legal_name, ein, naics_code, address_line1, city, state, zip, entity_type, dba, phone, " +
            "employee_count, year_founded, unique_entity_id, special_ownership_type, special_ownership_type_other, " +
            "project_address_street, project_address_city, project_address_state, project_address_zip, " +
            "primary_contact_name, primary_contact_email",
        )
        .eq("id", borrowerId)
        .maybeSingle()
    : { data: null };

  const { data: dealFranchise } = await sb
    .from("deal_franchises")
    .select("brand_id")
    .eq("deal_id", dealId)
    .maybeSingle();
  const franchiseBrandId =
    (dealFranchise as { brand_id?: string } | null)?.brand_id ??
    (loanRequest as { franchise_brand_id?: string } | null)?.franchise_brand_id ??
    null;
  const { data: franchiseBrand } = franchiseBrandId
    ? await sb
        .from("franchise_brands")
        .select("brand_name, sba_directory_id")
        .eq("id", franchiseBrandId)
        .maybeSingle()
    : { data: null };

  const useOfProceeds = (loanRequest as { use_of_proceeds?: unknown } | null)?.use_of_proceeds;
  // Loan-purpose amount breakdown (Section I: equipment/working capital/
  // business acquisition/inventory/debt refinance/construction) needs a
  // confirmed category taxonomy on use_of_proceeds line items to split
  // correctly — not confirmed in this pass, so the whole use-of-proceeds
  // description routes through the form's generic "Other" purpose slot
  // rather than guessing which specific category each line item belongs
  // to. Revisit once use_of_proceeds's real category vocabulary is
  // confirmed.
  const useOfProceedsSummary = Array.isArray(useOfProceeds)
    ? useOfProceeds
        .map((l: any) => l?.description ?? l?.category)
        .filter(Boolean)
        .join("; ") || null
    : null;

  const b = borrower as Record<string, any> | null;

  const sectionI: Form1919Input["sectionI"] = {
    applicant_legal_name: b?.legal_name ?? null,
    applicant_dba: b?.dba ?? null,
    applicant_ein: b?.ein ?? null,
    unique_entity_id: b?.unique_entity_id ?? null,
    applicant_address_street: b?.address_line1 ?? null,
    applicant_address_city: b?.city ?? null,
    applicant_address_state: b?.state ?? null,
    applicant_address_zip: b?.zip ?? null,
    project_address_street: b?.project_address_street ?? null,
    project_address_city: b?.project_address_city ?? null,
    project_address_state: b?.project_address_state ?? null,
    project_address_zip: b?.project_address_zip ?? null,
    applicant_phone: b?.phone ?? null,
    applicant_business_type: b?.entity_type ?? null,
    special_ownership_type: b?.special_ownership_type ?? null,
    special_ownership_type_other: b?.special_ownership_type_other ?? null,
    applicant_naics: b?.naics_code ?? null,
    applicant_employee_count: b?.employee_count ?? null,
    applicant_year_founded: b?.year_founded ?? null,
    poc_name: b?.primary_contact_name ?? null,
    poc_email: b?.primary_contact_email ?? null,
    loan_amount:
      (loanRequest as { requested_amount?: number } | null)?.requested_amount ??
      (deal as { loan_amount?: number } | null)?.loan_amount ??
      null,
    loan_program: (deal as { deal_type?: string } | null)?.deal_type ?? null,
    jobs_retained: (loanRequest as { jobs_retained_count?: number } | null)?.jobs_retained_count ?? null,
    jobs_created: (loanRequest as { jobs_created_count?: number } | null)?.jobs_created_count ?? null,
    use_of_proceeds_summary: useOfProceedsSummary,
    is_franchise_deal: Boolean(franchiseBrandId),
    franchise_identifier_code: (franchiseBrand as { sba_directory_id?: string } | null)?.sba_directory_id ?? null,
    franchise_brand_name: (franchiseBrand as { brand_name?: string } | null)?.brand_name ?? null,
  };

  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select(
      "id, entity_type, display_name, ownership_pct, title, tax_id_last4, citizenship_status, date_of_birth, " +
        "place_of_birth, home_address_street, home_address_city, home_address_state, home_address_zip, " +
        "alien_registration_number, is_us_government_employee, has_other_government_employment, " +
        "veteran_status, sex, race, ethnicity, " +
        "debarred_ineligible_or_bankrupt, defaulted_or_delinquent_gov_loan, owns_other_business, " +
        "incarcerated_or_indicted_financial_crime, has_export_sales, fee_paid_to_lender_or_broker, " +
        "restricted_revenue_source, sba_employee_conflict, former_sba_employee_conflict, " +
        "congress_legislative_judicial_conflict, federal_employee_or_military_conflict, " +
        "score_or_advisory_council_member, legal_action_pending, " +
        "export_sales_total, export_country_1, export_country_2, export_country_3, " +
        "entity_ein, entity_address_street, entity_address_city, entity_address_state, entity_address_zip, evidence_json",
    )
    .eq("deal_id", dealId);

  const entities = (ownershipEntities ?? []) as Array<Record<string, any>>;

  const sectionII: Form1919Input["sectionII"] = [];
  for (const e of entities) {
    if (!isIndividual(e.entity_type)) continue;
    const evidence = (e.evidence_json ?? {}) as Record<string, any>;

    const { data: piiRows } = await sb
      .from("deal_pii_records")
      .select("pii_type")
      .eq("deal_id", dealId)
      .eq("ownership_entity_id", e.id)
      .eq("pii_type", "full_ssn");
    const ssnOnFile = ((piiRows ?? []) as Array<{ pii_type: string }>).length > 0;

    sectionII.push({
      ownership_entity_id: String(e.id),
      fields: {
        full_name: e.display_name ?? null,
        position: e.title ?? null,
        // Presence marker only — see render.ts for the decrypt step.
        full_ssn: ssnOnFile ? "on_file" : null,
        date_of_birth: e.date_of_birth ?? evidence.date_of_birth ?? null,
        place_of_birth: e.place_of_birth ?? evidence.place_of_birth ?? null,
        is_us_citizen: e.citizenship_status ? e.citizenship_status === "us_citizen" : null,
        is_us_national: e.citizenship_status ? e.citizenship_status === "us_national" : null,
        is_lpr: e.citizenship_status ? e.citizenship_status === "lawful_permanent_resident" : null,
        alien_registration_number: e.alien_registration_number ?? evidence.alien_registration_number ?? null,
        home_address_street: e.home_address_street ?? evidence.home_address_street ?? null,
        home_address_city: e.home_address_city ?? evidence.home_address_city ?? null,
        home_address_state: e.home_address_state ?? evidence.home_address_state ?? null,
        home_address_zip: e.home_address_zip ?? evidence.home_address_zip ?? null,
        veteran_status: e.veteran_status ?? null,
        sex: e.sex ?? null,
        race: e.race ?? null,
        ethnicity: e.ethnicity ?? null,
        debarred_ineligible_or_bankrupt: e.debarred_ineligible_or_bankrupt ?? null,
        defaulted_or_delinquent_gov_loan: e.defaulted_or_delinquent_gov_loan ?? null,
        owns_other_business: e.owns_other_business ?? null,
        incarcerated_or_indicted_financial_crime: e.incarcerated_or_indicted_financial_crime ?? null,
        has_export_sales: e.has_export_sales ?? null,
        fee_paid_to_lender_or_broker: e.fee_paid_to_lender_or_broker ?? null,
        restricted_revenue_source: e.restricted_revenue_source ?? null,
        sba_employee_conflict: e.sba_employee_conflict ?? null,
        former_sba_employee_conflict: e.former_sba_employee_conflict ?? null,
        congress_legislative_judicial_conflict: e.congress_legislative_judicial_conflict ?? null,
        federal_employee_or_military_conflict: e.federal_employee_or_military_conflict ?? null,
        score_or_advisory_council_member: e.score_or_advisory_council_member ?? null,
        legal_action_pending: e.legal_action_pending ?? null,
        export_sales_total: e.export_sales_total ?? null,
        export_country_1: e.export_country_1 ?? null,
        export_country_2: e.export_country_2 ?? null,
        export_country_3: e.export_country_3 ?? null,
      },
    });
  }

  const sectionIII: Form1919Input["sectionIII"] = entities
    .filter((e) => isEquityEntity(e.entity_type))
    .map((e) => {
      const evidence = (e.evidence_json ?? {}) as Record<string, any>;
      return {
        ownership_entity_id: String(e.id),
        fields: {
          legal_name: e.display_name ?? null,
          ein: e.entity_ein ?? evidence.ein ?? null,
          entity_type: e.entity_type ?? null,
          address_street: e.entity_address_street ?? evidence.address_street ?? null,
          address_city: e.entity_address_city ?? evidence.address_city ?? null,
          address_state: e.entity_address_state ?? evidence.address_state ?? null,
          address_zip: e.entity_address_zip ?? evidence.address_zip ?? null,
        },
      };
    });

  // Up to 5 owners for Section I's summary roster — every individual and
  // equity entity on the deal, name/title/%/home-or-entity-address.
  // Full TINs aren't resolved here — render.ts decrypts each roster
  // owner's SSN (or reads entity_ein directly for entities, which isn't
  // vaulted PII) at fill time, same discipline as the signer's own SSN.
  const roster: Form1919Input["ownerRoster"] = entities.slice(0, 5).map((e) => ({
    ownership_entity_id: String(e.id),
    name: e.display_name ?? null,
    title: e.title ?? (isEquityEntity(e.entity_type) ? "Entity Owner" : null),
    percentage: e.ownership_pct ?? null,
    is_individual: isIndividual(e.entity_type),
    entity_ein: e.entity_ein ?? null,
    home_address:
      [e.home_address_street, [e.home_address_city, e.home_address_state].filter(Boolean).join(", "), e.home_address_zip]
        .filter((p) => p != null && p !== "")
        .join(", ") || null,
  }));

  return { sectionI, sectionII, sectionIII, ownerRoster: roster };
}
