import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FORM_1919_SECTION_II_FIELDS } from "@/lib/sba/forms/form1919/fields";
import { storeSecurePii } from "@/lib/builder/secure/securePiiIntake";
import { acknowledgeForm722 } from "@/lib/sba/forms/form722/service";

/** Synthetic input only. Never creates signatures, approvals or generated outputs. */
export async function seedGoldenTridentQaForms(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
) {
  const { data: deal, error } = await sb
    .from("deals")
    .select("id,borrower_id,is_test")
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .single();
  if (error || deal?.is_test !== true)
    throw new Error("SBA test inputs require a verified test application");
  const save = async (
    name: string,
    query: PromiseLike<{ error: { message: string } | null }>,
  ) => {
    const { error } = await query;
    if (error) throw new Error(`${name}: ${error.message}`);
  };
  const borrowerId = deal.borrower_id ?? crypto.randomUUID();
  await save(
    "QA business",
    sb.from("borrowers").upsert({
      id: borrowerId,
      bank_id: bankId,
      legal_name: "Apex Precision Fabrication, LLC",
      ein: "00-0000001",
      address_line1: "100 Synthetic Test Way",
      city: "Fort Worth",
      state: "TX",
      zip: "76102",
      phone: "8175550100",
      entity_type: "llc",
      naics_code: "332710",
      employee_count: 12,
      year_founded: 2017,
      contact_name: "Jordan Ellis",
      contact_email: "golden-trident-qa@test.local",
    }),
  );
  await save(
    "QA borrower link",
    sb
      .from("deals")
      .update({ borrower_id: borrowerId })
      .eq("id", dealId)
      .eq("is_test", true),
  );
  const { data: owners, error: ownerError } = await sb
    .from("ownership_entities")
    .select("id")
    .eq("deal_id", dealId)
    .eq("display_name", "Jordan Ellis");
  if (ownerError) throw new Error(ownerError.message);
  const ownerId = owners?.[0]?.id ?? crypto.randomUUID();
  const start = FORM_1919_SECTION_II_FIELDS.findIndex(
    (f) => f.key === "debarred_ineligible_or_bankrupt",
  );
  const end = FORM_1919_SECTION_II_FIELDS.findIndex(
    (f) => f.key === "legal_action_pending",
  );
  const disclosures = Object.fromEntries(
    FORM_1919_SECTION_II_FIELDS.slice(start, end + 1).map((f) => [
      f.key,
      false,
    ]),
  );
  await save(
    "QA owner",
    sb.from("ownership_entities").upsert({
      id: ownerId,
      deal_id: dealId,
      entity_type: "individual",
      display_name: "Jordan Ellis",
      ownership_pct: 100,
      title: "President",
      citizenship_status: "us_citizen",
      date_of_birth: "1980-01-01",
      place_of_birth: "Texas, USA",
      home_address_street: "100 Synthetic Test Way",
      home_address_city: "Fort Worth",
      home_address_state: "TX",
      home_address_zip: "76102",
      home_phone: "8175550100",
      business_phone: "8175550100",
      has_spouse: false,
      evidence_json: { synthetic_qa: true, has_spouse: false },
      ...disclosures,
    }),
  );
  await save(
    "QA personal financials",
    sb.from("borrower_applicant_financials").upsert(
      {
        applicant_id: ownerId,
        liquid_assets: 200000,
        asset_savings_accounts: 50000,
        asset_ira_retirement: 100000,
        asset_real_estate: 0,
        asset_automobile: 20000,
        liability_mortgages_on_real_estate: 0,
        liability_installment_auto: 10000,
        income_salary: 150000,
        net_worth: 360000,
      },
      { onConflict: "applicant_id" },
    ),
  );
  const pii = await storeSecurePii({
    dealId,
    bankId,
    ownershipEntityId: ownerId,
    piiType: "full_ssn",
    plaintext: "000000001",
    actorUserId: "synthetic_qa",
  });
  if (!pii.ok) throw new Error(`QA protected identifier: ${pii.error}`);
  const { data: loan, error: loanError } = await sb
    .from("deal_loan_requests")
    .select("id")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (loanError) throw new Error(loanError.message);
  const { data: proceeds, error: proceedsError } = await sb
    .from("deal_proceeds_items")
    .select("category,description,amount")
    .eq("deal_id", dealId);
  if (proceedsError) throw new Error(proceedsError.message);
  await save(
    "QA loan request",
    sb.from("deal_loan_requests").upsert({
      id: loan?.id ?? crypto.randomUUID(),
      deal_id: dealId,
      bank_id: bankId,
      product_type: "SBA_7A",
      sba_program: "7A",
      requested_amount: 850000,
      use_of_proceeds: proceeds ?? [],
      tax_years: "2023, 2024, 2025",
      agent_used: false,
    }),
  );
  const acknowledgment = await acknowledgeForm722(dealId, bankId, sb, {
    acknowledgedByUserId: "synthetic_qa",
  });
  if (!acknowledgment.ok && acknowledgment.reason !== "ALREADY_ACKNOWLEDGED")
    throw new Error(`QA poster: ${acknowledgment.reason}`);
}
