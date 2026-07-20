import type { Form1244Input, Form1244OwnerRosterRow } from "@/lib/sba/forms/form1244/build";

export type Form1244InputBuilderClient = { from: (table: string) => any };

function isIndividual(entityType: string | null | undefined): boolean {
  return entityType === "individual" || entityType === "person";
}

function combineAddress(street: unknown, city: unknown, state: unknown, zip: unknown): string | null {
  const parts = [street, [city, state].filter(Boolean).join(", "), zip].filter((p) => p != null && p !== "");
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * SPEC S6 (ARC-00 Phase 4) — assembles Form1244Input from canonical
 * state. Rewritten against a real copy of the current PDF (see
 * fields.ts/pdfFieldMap.ts):
 *   Section One  <- borrowers (Applicant/EPC) + deals (Operating Company
 *                   — a dual-entity concept with no prior representation)
 *   Owner roster <- ownership_entities, up to 10 rows. This schema
 *                   doesn't track WHICH entity (EPC vs OC) an owner
 *                   belongs to, so when isEligiblePassiveCompany is
 *                   true, the same owner list populates both rosters
 *                   (the common real-world case — same principals own
 *                   both) rather than guessing a split.
 *   Section Two  <- ownership_entities where entity_type='individual',
 *                   one entry per person (one rendered PDF each — see
 *                   render.ts), the real 5-question set, not 1919's 13.
 */
export async function buildForm1244Input(dealId: string, sb: Form1244InputBuilderClient): Promise<Form1244Input> {
  const { data: deal } = await sb
    .from("deals")
    .select(
      "id, name, loan_amount, borrower_id, is_eligible_passive_company, operating_company_legal_name, " +
        "operating_company_address, operating_company_dba, operating_company_legal_structure, operating_company_tax_id, " +
        "operating_company_duns_number, operating_company_contact_name, operating_company_email, " +
        "operating_company_phone, operating_company_website",
    )
    .eq("id", dealId)
    .maybeSingle();

  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select("requested_amount, loan_purpose, jobs_created_count, jobs_retained_count")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const borrowerId = (deal as { borrower_id?: string } | null)?.borrower_id ?? null;
  const { data: borrower } = borrowerId
    ? await sb
        .from("borrowers")
        .select(
          "legal_name, dba, entity_type, ein, duns_number, contact_name, contact_email, phone, website, " +
            "naics_description, employee_count, address_line1, city, state, zip, has_affiliates, " +
            "obtained_direct_or_guaranteed_government_loan, prior_project_application_submitted, " +
            "prior_project_cdc_lender_name_and_program, has_bankruptcy_history, has_pending_lawsuits",
        )
        .eq("id", borrowerId)
        .maybeSingle()
    : { data: null };

  const d = (deal ?? {}) as Record<string, any>;
  const lr = (loanRequest ?? {}) as Record<string, any>;
  const b = (borrower ?? {}) as Record<string, any>;
  const isEligiblePassiveCompany = Boolean(d.is_eligible_passive_company);

  const sectionI: Form1244Input["sectionI"] = {
    applicant_legal_name: b.legal_name ?? null,
    applicant_address: combineAddress(b.address_line1, b.city, b.state, b.zip),
    applicant_dba: b.dba ?? null,
    applicant_legal_structure: b.entity_type ?? null,
    applicant_tax_id: b.ein ?? null,
    applicant_duns_number: b.duns_number ?? null,
    applicant_contact_name: b.contact_name ?? null,
    applicant_email: b.contact_email ?? null,
    applicant_phone: b.phone ?? null,
    applicant_website: b.website ?? null,

    oc_legal_name: isEligiblePassiveCompany ? (d.operating_company_legal_name ?? null) : null,
    oc_address: isEligiblePassiveCompany ? (d.operating_company_address ?? null) : null,
    oc_dba: isEligiblePassiveCompany ? (d.operating_company_dba ?? null) : null,
    oc_legal_structure: isEligiblePassiveCompany ? (d.operating_company_legal_structure ?? null) : null,
    oc_tax_id: isEligiblePassiveCompany ? (d.operating_company_tax_id ?? null) : null,
    oc_duns_number: isEligiblePassiveCompany ? (d.operating_company_duns_number ?? null) : null,
    oc_contact_name: isEligiblePassiveCompany ? (d.operating_company_contact_name ?? null) : null,
    oc_email: isEligiblePassiveCompany ? (d.operating_company_email ?? null) : null,
    oc_phone: isEligiblePassiveCompany ? (d.operating_company_phone ?? null) : null,
    oc_website: isEligiblePassiveCompany ? (d.operating_company_website ?? null) : null,

    type_of_business: b.naics_description ?? null,
    existing_employee_count: b.employee_count ?? null,
    jobs_to_be_created: lr.jobs_created_count ?? null,
    jobs_to_be_retained: lr.jobs_retained_count ?? null,
    loan_amount_required: lr.requested_amount ?? d.loan_amount ?? null,
    loan_purpose: lr.loan_purpose ?? null,
    has_affiliates: b.has_affiliates ?? null,
    obtained_direct_or_guaranteed_loan: b.obtained_direct_or_guaranteed_government_loan ?? null,
    prior_application_submitted: b.prior_project_application_submitted ?? null,
    prior_cdc_lender_name_and_program: b.prior_project_cdc_lender_name_and_program ?? null,
    ever_bankrupt: b.has_bankruptcy_history ?? null,
    pending_lawsuits: b.has_pending_lawsuits ?? null,
  };

  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select(
      "id, entity_type, display_name, title, ownership_pct, citizenship_status, date_of_birth, place_of_birth, " +
        "home_address_street, home_address_city, home_address_state, home_address_zip, home_phone, " +
        "former_names_and_dates_used, country_of_citizenship, sba_loan_entity_interest, " +
        "sba_loan_entity_interest_details, subject_to_indictment, arrested_or_charged_6mo, " +
        "convicted_diversion_or_parole, suspended_debarred_ineligible",
    )
    .eq("deal_id", dealId);

  const entities = (ownershipEntities ?? []) as Array<Record<string, any>>;

  const rosterRow = async (e: Record<string, any>): Promise<Form1244OwnerRosterRow> => {
    const { data: piiRows } = await sb
      .from("deal_pii_records")
      .select("pii_type")
      .eq("deal_id", dealId)
      .eq("ownership_entity_id", e.id)
      .eq("pii_type", "full_ssn");
    const ssnOnFile = ((piiRows ?? []) as Array<{ pii_type: string }>).length > 0;
    return {
      ownership_entity_id: String(e.id),
      name: e.display_name ?? null,
      title: e.title ?? null,
      ssn_tin_on_file: ssnOnFile,
      ownership_pct: e.ownership_pct ?? null,
    };
  };

  const applicantOwnerRoster: Form1244OwnerRosterRow[] = [];
  for (const e of entities.slice(0, 10)) {
    applicantOwnerRoster.push(await rosterRow(e));
  }
  // No column distinguishes EPC-owner vs OC-owner today — the same
  // principals own both in the common real-world case, so the OC roster
  // mirrors the applicant roster rather than guessing a split.
  const ocOwnerRoster: Form1244OwnerRosterRow[] = isEligiblePassiveCompany ? applicantOwnerRoster : [];

  const sectionII: Form1244Input["sectionII"] = [];
  for (const e of entities) {
    if (!isIndividual(e.entity_type)) continue;
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
        former_names_and_dates_used: e.former_names_and_dates_used ?? null,
        is_us_citizen: e.citizenship_status ? e.citizenship_status === "us_citizen" : null,
        country_of_citizenship: e.country_of_citizenship ?? null,
        place_of_birth: e.place_of_birth ?? null,
        date_of_birth: e.date_of_birth ?? null,
        full_ssn: ssnOnFile ? "on_file" : null,
        phone: e.home_phone ?? null,
        home_address: combineAddress(e.home_address_street, e.home_address_city, e.home_address_state, e.home_address_zip),
        sba_loan_entity_interest: e.sba_loan_entity_interest ?? null,
        sba_loan_entity_interest_details: e.sba_loan_entity_interest_details ?? null,
        subject_to_indictment: e.subject_to_indictment ?? null,
        arrested_6mo: e.arrested_or_charged_6mo ?? null,
        convicted_diversion_or_parole: e.convicted_diversion_or_parole ?? null,
        suspended_debarred_ineligible: e.suspended_debarred_ineligible ?? null,
      },
    });
  }

  return { sectionI, isEligiblePassiveCompany, applicantOwnerRoster, ocOwnerRoster, sectionII };
}
