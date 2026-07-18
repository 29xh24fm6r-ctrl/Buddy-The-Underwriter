import type { Form1244Input } from "@/lib/sba/forms/form1244/build";

export type Form1244InputBuilderClient = { from: (table: string) => any };

function isIndividual(entityType: string | null | undefined): boolean {
  return entityType === "individual" || entityType === "person";
}

function isEquityEntity(entityType: string | null | undefined): boolean {
  return ["corporation", "llc", "partnership", "trust"].includes(entityType ?? "");
}

type PropertyAddress = { street?: string; city?: string; state?: string; zip?: string } | null;

/**
 * SPEC S6 (ARC-00 Phase 4) — assembles Form1244Input from canonical state.
 *   Section I  <- deals + deal_loan_requests (incl. the new 504
 *                 project-cost-split columns from
 *                 20260711_a_deal_loan_requests_504_project_cost.sql) +
 *                 borrowers + franchise_brands
 *   Section II <- ownership_entities where entity_type='individual'
 *   Section III<- ownership_entities where entity_type IN (corp/llc/partnership/trust)
 * Mirrors form1919/inputBuilder.ts's structure and query pattern exactly.
 */
export async function buildForm1244Input(dealId: string, sb: Form1244InputBuilderClient): Promise<Form1244Input> {
  const { data: deal } = await sb
    .from("deals")
    .select("id, deal_type, loan_amount, borrower_id")
    .eq("id", dealId)
    .maybeSingle();

  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select(
      "franchise_brand_id, total_project_cost, third_party_lender_amount, cdc_debenture_amount, " +
        "borrower_contribution_amount, occupancy_percentage, creates_or_retains_jobs, jobs_created_count, " +
        "jobs_retained_count, meets_public_policy_goal, public_policy_goal_description, includes_debt_refinance, " +
        "debt_refinance_amount, property_address_json",
    )
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
            "employee_count, year_founded, has_pending_sba_application, has_bankruptcy_history, " +
            "has_pending_lawsuits, is_engaged_in_lobbying",
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
    ? await sb.from("franchise_brands").select("brand_name, sba_directory_id").eq("id", franchiseBrandId).maybeSingle()
    : { data: null };

  const projectAddress = ((loanRequest as { property_address_json?: unknown } | null)?.property_address_json ?? null) as PropertyAddress;

  const b = borrower as Record<string, any> | null;

  const sectionI: Form1244Input["sectionI"] = {
    applicant_legal_name: b?.legal_name ?? null,
    applicant_dba: b?.dba ?? null,
    applicant_ein: b?.ein ?? null,
    applicant_address_street: b?.address_line1 ?? null,
    applicant_address_city: b?.city ?? null,
    applicant_address_state: b?.state ?? null,
    applicant_address_zip: b?.zip ?? null,
    applicant_phone: b?.phone ?? null,
    applicant_business_type: b?.entity_type ?? null,
    applicant_naics: b?.naics_code ?? null,
    applicant_employee_count: b?.employee_count ?? null,
    applicant_year_founded: b?.year_founded ?? null,
    project_address_street: projectAddress?.street ?? null,
    project_address_city: projectAddress?.city ?? null,
    project_address_state: projectAddress?.state ?? null,
    project_address_zip: projectAddress?.zip ?? null,
    total_project_cost: (loanRequest as { total_project_cost?: number } | null)?.total_project_cost ?? null,
    third_party_lender_amount: (loanRequest as { third_party_lender_amount?: number } | null)?.third_party_lender_amount ?? null,
    cdc_debenture_amount: (loanRequest as { cdc_debenture_amount?: number } | null)?.cdc_debenture_amount ?? null,
    borrower_contribution_amount: (loanRequest as { borrower_contribution_amount?: number } | null)?.borrower_contribution_amount ?? null,
    occupancy_percentage: (loanRequest as { occupancy_percentage?: number } | null)?.occupancy_percentage ?? null,
    creates_or_retains_jobs: (loanRequest as { creates_or_retains_jobs?: boolean } | null)?.creates_or_retains_jobs ?? null,
    jobs_created_count: (loanRequest as { jobs_created_count?: number } | null)?.jobs_created_count ?? null,
    jobs_retained_count: (loanRequest as { jobs_retained_count?: number } | null)?.jobs_retained_count ?? null,
    meets_public_policy_goal: (loanRequest as { meets_public_policy_goal?: boolean } | null)?.meets_public_policy_goal ?? null,
    public_policy_goal_description: (loanRequest as { public_policy_goal_description?: string } | null)?.public_policy_goal_description ?? null,
    includes_debt_refinance: (loanRequest as { includes_debt_refinance?: boolean } | null)?.includes_debt_refinance ?? null,
    debt_refinance_amount: (loanRequest as { debt_refinance_amount?: number } | null)?.debt_refinance_amount ?? null,
    is_franchise_deal: Boolean(franchiseBrandId),
    franchise_identifier_code: (franchiseBrand as { sba_directory_id?: string } | null)?.sba_directory_id ?? null,
    franchise_brand_name: (franchiseBrand as { brand_name?: string } | null)?.brand_name ?? null,
    has_other_sba_application_pending: b?.has_pending_sba_application ?? null,
    has_been_in_bankruptcy_pending: b?.has_bankruptcy_history ?? null,
    has_pending_lawsuits: b?.has_pending_lawsuits ?? null,
    is_engaged_in_lobbying: b?.is_engaged_in_lobbying ?? null,
  };

  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select(
      "id, entity_type, display_name, title, ownership_pct, citizenship_status, date_of_birth, " +
        "place_of_birth, home_address_street, home_address_city, home_address_state, home_address_zip, " +
        "alien_registration_number, is_us_government_employee, has_other_government_employment, " +
        "arrested_or_charged_6mo, convicted_or_pleaded, pending_criminal_charges, subject_to_indictment, " +
        "on_parole_or_probation, veteran_status, sex, race, ethnicity, " +
        "debarred_ineligible_or_bankrupt, defaulted_or_delinquent_gov_loan, owns_other_business, " +
        "incarcerated_or_indicted_financial_crime, fee_paid_to_cdc_or_broker, fee_paid_to_lender_or_broker, " +
        "restricted_revenue_source, sba_employee_conflict, former_sba_employee_conflict, " +
        "congress_legislative_judicial_conflict, federal_employee_or_military_conflict, " +
        "score_or_advisory_council_member, legal_action_pending, " +
        "export_sales_total, export_country_1, export_country_2, export_country_3, " +
        "entity_ein, entity_address_street, entity_address_city, entity_address_state, entity_address_zip, evidence_json",
    )
    .eq("deal_id", dealId);

  const entities = (ownershipEntities ?? []) as Array<Record<string, any>>;

  // Section II is imported directly from form1919/fields.ts (see
  // FORM_1244_SECTION_II_FIELDS above) — the same real 13-question/
  // demographics/export field set, and the same underlying
  // ownership_entities columns, as form1919/inputBuilder.ts. Kept in
  // sync with that file rather than diverging, since it's identical
  // data; 1244's own PDF hasn't been separately re-verified yet (backlog
  // per docs/sba-forms/TASK-A-FORM-COVERAGE-AUDIT.md).
  const sectionII: Form1244Input["sectionII"] = [];
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
        fee_paid_to_cdc_or_broker: e.fee_paid_to_cdc_or_broker ?? null,
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
        // Old 5-category fields — no longer part of FORM_1919_SECTION_II_FIELDS's
        // required set, but kept populated here too since src/lib/score/*
        // still reads these exact keys off other consumers of this shape.
        has_been_arrested_or_charged_in_6mo: e.arrested_or_charged_6mo ?? evidence.has_been_arrested_or_charged_in_6mo ?? null,
        has_been_convicted_or_pleaded: e.convicted_or_pleaded ?? evidence.has_been_convicted_or_pleaded ?? null,
        has_pending_criminal_charges: e.pending_criminal_charges ?? evidence.has_pending_criminal_charges ?? null,
        is_subject_to_indictment: e.subject_to_indictment ?? evidence.is_subject_to_indictment ?? null,
        has_paroled_or_probation: e.on_parole_or_probation ?? evidence.has_paroled_or_probation ?? null,
      },
    });
  }

  const sectionIII: Form1244Input["sectionIII"] = entities
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

  return { sectionI, sectionII, sectionIII };
}
