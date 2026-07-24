import type { Form4506cInput } from "@/lib/sba/forms/form4506c/build";

export type Form4506cInputBuilderClient = { from: (table: string) => any };

function isIndividual(entityType: string | null | undefined): boolean {
  return entityType === "individual" || entityType === "person";
}

/** Best-effort first/last split of a single display_name field — this
 * repo doesn't store separate first/last name columns. Documented
 * simplification, not a guess about form content: the actual PDF field
 * split (first/middle/last) is real, but Buddy's own data isn't
 * structured that way yet. */
function splitName(fullName: string | null | undefined): { first: string | null; last: string | null } {
  if (!fullName) return { first: null, last: null };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/** Splits deal_loan_requests.tax_years (free text, e.g. "2022, 2023, 2024")
 * into up to 4 period-end dates (Dec 31 of each year) for §8. */
function parseTaxPeriods(taxYears: string | null): string[] {
  if (!taxYears) return [];
  return taxYears
    .split(/[,;/]/)
    .map((y) => y.trim())
    .filter((y) => /^\d{4}$/.test(y))
    .slice(0, 4)
    .map((y) => `12/31/${y}`);
}

/**
 * SPEC S4 D-1 — assembles Form4506cInput from canonical state. One signer
 * per individual owner (business-entity self-filed returns are a real gap
 * — not built here; flagged in the Drift Log). Third-party recipient
 * (§5d "client") = the lender bank.
 *
 * Field set rewritten against the real current-revision PDF (see
 * fields.ts / pdfFieldMap.ts). Full taxpayer SSN comes from
 * deal_pii_records (see the same full-SSN handling as Form 912/413) —
 * only a presence marker flows through this builder; the real value is
 * decrypted exclusively inside render.ts at fill time. Spouse SSN isn't
 * collected anywhere in this schema yet (a real, separate gap from the
 * primary signer's SSN handling — not built here either).
 */
export async function buildForm4506cInput(dealId: string, bankId: string, sb: Form4506cInputBuilderClient): Promise<Form4506cInput> {
  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select(
      "id, entity_type, display_name, title, home_address_street, home_address_city, home_address_state, " +
        "home_address_zip, has_spouse, spouse_full_name, home_phone, business_phone",
    )
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
  const taxPeriods = parseTaxPeriods(taxYears);

  const signers: Form4506cInput["signers"] = [];
  for (const e of (ownershipEntities ?? []) as Array<Record<string, any>>) {
    if (!isIndividual(e.entity_type)) continue;

    const { data: piiRows } = await sb
      .from("deal_pii_records")
      .select("pii_type")
      .eq("deal_id", dealId)
      .eq("ownership_entity_id", e.id)
      .eq("pii_type", "full_ssn");
    const ssnOnFile = ((piiRows ?? []) as Array<{ pii_type: string }>).length > 0;

    const { first, last } = splitName(e.display_name);
    const spouse = splitName(e.has_spouse ? e.spouse_full_name : null);

    signers.push({
      ownership_entity_id: String(e.id),
      fields: {
        taxpayer_first_name: first,
        taxpayer_last_name: last,
        taxpayer_id: ssnOnFile ? "on_file" : null,
        spouse_first_name: spouse.first,
        spouse_last_name: spouse.last,
        current_address_street: e.home_address_street ?? null,
        current_address_city: e.home_address_city ?? null,
        current_address_state: e.home_address_state ?? null,
        current_address_zip: e.home_address_zip ?? null,
        // The real PDF field has a 10-char max length (confirmed via a
        // fill test — a raw UUID doesn't fit) — truncate rather than let
        // pdf-lib throw and silently drop the whole value.
        customer_file_number: dealId.slice(0, 10),
        tax_form_number_line6: "1040",
        transcript_type_return: true,
        transcript_type_account: true,
        transcript_type_record_of_account: false,
        wants_wage_income_transcript: true,
        wage_income_form_numbers: null,
        tax_periods: taxPeriods.length > 0 ? taxPeriods : null,
        signer_print_name: e.display_name ?? null,
        signer_title: e.title ?? null,
        signer_phone: e.business_phone ?? e.home_phone ?? null,
      },
    });
  }

  return {
    signers,
    thirdParty: {
      client_name: (bank as { name?: string } | null)?.name ?? null,
      client_phone: null,
      client_address: null,
    },
  };
}
