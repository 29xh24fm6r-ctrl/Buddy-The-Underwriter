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
    .select("requested_amount, use_of_proceeds, franchise_brand_id, purpose, loan_purpose, purpose_category")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const borrowerId = (deal as { borrower_id?: string } | null)?.borrower_id ?? null;
  const { data: borrower } = borrowerId
    ? await sb
        .from("borrowers")
        .select("legal_name, ein, naics_code, address_line1, city, state, zip, entity_type")
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
  const useOfProceedsSummary = Array.isArray(useOfProceeds)
    ? useOfProceeds
        .map((l: any) => l?.description ?? l?.category)
        .filter(Boolean)
        .join("; ") || null
    : null;

  const sectionI: Form1919Input["sectionI"] = {
    applicant_legal_name: (borrower as { legal_name?: string } | null)?.legal_name ?? null,
    applicant_dba: null,
    applicant_ein: (borrower as { ein?: string } | null)?.ein ?? null,
    applicant_address_street: (borrower as { address_line1?: string } | null)?.address_line1 ?? null,
    applicant_address_city: (borrower as { city?: string } | null)?.city ?? null,
    applicant_address_state: (borrower as { state?: string } | null)?.state ?? null,
    applicant_address_zip: (borrower as { zip?: string } | null)?.zip ?? null,
    applicant_phone: null,
    applicant_business_type: (borrower as { entity_type?: string } | null)?.entity_type ?? null,
    applicant_naics: (borrower as { naics_code?: string } | null)?.naics_code ?? null,
    applicant_employee_count: null,
    applicant_year_founded: null,
    loan_amount:
      (loanRequest as { requested_amount?: number } | null)?.requested_amount ??
      (deal as { loan_amount?: number } | null)?.loan_amount ??
      null,
    loan_program: (deal as { deal_type?: string } | null)?.deal_type ?? null,
    use_of_proceeds_summary: useOfProceedsSummary,
    is_franchise_deal: Boolean(franchiseBrandId),
    franchise_identifier_code: (franchiseBrand as { sba_directory_id?: string } | null)?.sba_directory_id ?? null,
    franchise_brand_name: (franchiseBrand as { brand_name?: string } | null)?.brand_name ?? null,
    has_other_sba_application_pending: null,
    has_been_in_bankruptcy_pending: null,
    has_pending_lawsuits: null,
    is_engaged_in_lobbying: null,
  };

  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select(
      "id, entity_type, display_name, tax_id_last4, ownership_pct, citizenship_status, date_of_birth, " +
        "place_of_birth, home_address_street, home_address_city, home_address_state, home_address_zip, evidence_json",
    )
    .eq("deal_id", dealId);

  const entities = (ownershipEntities ?? []) as Array<Record<string, any>>;

  const sectionII: Form1919Input["sectionII"] = entities
    .filter((e) => isIndividual(e.entity_type))
    .map((e) => {
      const evidence = (e.evidence_json ?? {}) as Record<string, any>;
      return {
        ownership_entity_id: String(e.id),
        fields: {
          full_name: e.display_name ?? null,
          ssn_last4: e.tax_id_last4 ?? null,
          date_of_birth: e.date_of_birth ?? evidence.date_of_birth ?? null,
          place_of_birth: e.place_of_birth ?? evidence.place_of_birth ?? null,
          is_us_citizen: e.citizenship_status ? e.citizenship_status === "us_citizen" : null,
          is_us_national: e.citizenship_status ? e.citizenship_status === "us_national" : null,
          is_lpr: e.citizenship_status ? e.citizenship_status === "lawful_permanent_resident" : null,
          alien_registration_number: evidence.alien_registration_number ?? null,
          home_address_street: e.home_address_street ?? evidence.home_address_street ?? null,
          home_address_city: e.home_address_city ?? evidence.home_address_city ?? null,
          home_address_state: e.home_address_state ?? evidence.home_address_state ?? null,
          home_address_zip: e.home_address_zip ?? evidence.home_address_zip ?? null,
          is_employee_of_us_government: evidence.is_employee_of_us_government ?? null,
          has_other_government_employment: evidence.has_other_government_employment ?? null,
          has_been_arrested_or_charged_in_6mo: evidence.has_been_arrested_or_charged_in_6mo ?? null,
          has_been_convicted_or_pleaded: evidence.has_been_convicted_or_pleaded ?? null,
          has_pending_criminal_charges: evidence.has_pending_criminal_charges ?? null,
          is_subject_to_indictment: evidence.is_subject_to_indictment ?? null,
          has_paroled_or_probation: evidence.has_paroled_or_probation ?? null,
        },
      };
    });

  const sectionIII: Form1919Input["sectionIII"] = entities
    .filter((e) => isEquityEntity(e.entity_type))
    .map((e) => {
      const evidence = (e.evidence_json ?? {}) as Record<string, any>;
      return {
        ownership_entity_id: String(e.id),
        fields: {
          legal_name: e.display_name ?? null,
          ein: evidence.ein ?? null,
          entity_type: e.entity_type ?? null,
          address_street: evidence.address_street ?? null,
          address_city: evidence.address_city ?? null,
          address_state: evidence.address_state ?? null,
          address_zip: evidence.address_zip ?? null,
        },
      };
    });

  return { sectionI, sectionII, sectionIII };
}
