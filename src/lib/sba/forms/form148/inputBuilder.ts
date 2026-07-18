import type { Form148Input } from "@/lib/sba/forms/form148/build";
import { determineGuaranteeType } from "@/lib/ownership/rules";

export type Form148InputBuilderClient = { from: (table: string) => any };

function isIndividual(entityType: string | null | undefined): boolean {
  return entityType === "individual" || entityType === "person";
}

/**
 * SPEC S7 (ARC-00 Phase 5) — one Form 148/148L signer per individual owner
 * with a nonzero ownership stake; unconditional vs limited is decided by
 * ownership/rules.ts's determineGuaranteeType(), not here.
 *
 * Rewritten against real copies of both PDFs (see fields.ts/pdfFieldMap.ts):
 * sba_loan_number from sba_loans.loan_number (null until SBA-assigned —
 * same pattern as Form 155), note_date/agreement_date from
 * sba_loans.closing_date (the real forms' only date fields besides the
 * signature date, which is never pre-filled — see render.ts). 148L's
 * limitation type and its per-type amount/rate/description are
 * bank-negotiated per guarantor (ownership_entities columns), not a
 * single deal-wide cap the old model assumed.
 */
export async function buildForm148Input(dealId: string, bankId: string, sb: Form148InputBuilderClient): Promise<Form148Input> {
  const { data: deal } = await sb.from("deals").select("id, name, loan_amount, borrower_id").eq("id", dealId).maybeSingle();

  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select("requested_amount")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const borrowerId = (deal as { borrower_id?: string } | null)?.borrower_id ?? null;
  const { data: borrower } = borrowerId ? await sb.from("borrowers").select("legal_name").eq("id", borrowerId).maybeSingle() : { data: null };
  const { data: bank } = await sb.from("banks").select("name").eq("id", bankId).maybeSingle();
  const { data: sbaLoan } = await sb.from("sba_loans").select("loan_number, closing_date").eq("deal_id", dealId).maybeSingle();

  const loanAmount =
    (loanRequest as { requested_amount?: number } | null)?.requested_amount ??
    (deal as { loan_amount?: number } | null)?.loan_amount ??
    null;
  const sbaLoanNumber = (sbaLoan as { loan_number?: string } | null)?.loan_number ?? null;
  const closingDate = (sbaLoan as { closing_date?: string } | null)?.closing_date ?? null;
  const sbaLoanName = (deal as { name?: string } | null)?.name ?? (borrower as { legal_name?: string } | null)?.legal_name ?? null;

  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select(
      "id, entity_type, display_name, ownership_pct, guarantee_limitation_type, guarantee_limit_balance_under, " +
        "guarantee_limit_principal_under, guarantee_limit_max_payment, guarantee_limit_percent_payment, " +
        "guarantee_limit_time_years, guarantee_limit_collateral_description",
    )
    .eq("deal_id", dealId);

  const signers: Form148Input["signers"] = ((ownershipEntities ?? []) as Array<Record<string, any>>)
    .filter((e) => isIndividual(e.entity_type))
    .map((e) => ({ entity: e, guaranteeType: determineGuaranteeType(e.ownership_pct) }))
    .filter((x): x is { entity: Record<string, any>; guaranteeType: "unconditional" | "limited" } => x.guaranteeType != null)
    .map(({ entity, guaranteeType }) => ({
      ownership_entity_id: String(entity.id),
      guaranteeType,
      fields: {
        guarantor_name: entity.display_name ?? null,
        borrower_legal_name: (borrower as { legal_name?: string } | null)?.legal_name ?? null,
        lender_name: (bank as { name?: string } | null)?.name ?? null,
        loan_amount: loanAmount,
        ownership_pct: entity.ownership_pct ?? null,
        sba_loan_number: sbaLoanNumber,
        sba_loan_name: sbaLoanName,
        agreement_date: closingDate,
        note_date: closingDate,
        guarantee_limitation_type: guaranteeType === "limited" ? (entity.guarantee_limitation_type ?? null) : null,
        limit_balance_under: guaranteeType === "limited" ? (entity.guarantee_limit_balance_under ?? null) : null,
        limit_principal_under: guaranteeType === "limited" ? (entity.guarantee_limit_principal_under ?? null) : null,
        limit_max_payment: guaranteeType === "limited" ? (entity.guarantee_limit_max_payment ?? null) : null,
        limit_percent_payment: guaranteeType === "limited" ? (entity.guarantee_limit_percent_payment ?? null) : null,
        limit_time_years: guaranteeType === "limited" ? (entity.guarantee_limit_time_years ?? null) : null,
        limit_collateral_description: guaranteeType === "limited" ? (entity.guarantee_limit_collateral_description ?? null) : null,
      },
    }));

  return { signers };
}
