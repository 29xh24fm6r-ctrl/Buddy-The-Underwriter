import type { Form155BuildResult, Form155Input } from "@/lib/sba/forms/form155/build";
import { buildForm155 } from "@/lib/sba/forms/form155/build";

export type Form155InputBuilderClient = { from: (table: string) => any };

/**
 * SPEC S4 G-3 — applicable when `seller_note_equity_portion > 0` on the
 * latest deal_loan_requests row (per A-S4-4). Rewritten against the real
 * current-revision PDF (see fields.ts/pdfFieldMap.ts): sba_loan_number
 * comes from sba_loans.loan_number (SBA-assigned post-authorization —
 * null, surfaced as missing, until the loan is authorized), sba_loan_name
 * from deals.name. note_interest_rate/note_date are still sourced from
 * deal_loan_requests but reinterpreted per agree_option (see render.ts) —
 * the real form has no standalone "note date"/"interest rate" fields,
 * only per-option ones.
 */
export async function buildForm155Input(dealId: string, bankId: string, sb: Form155InputBuilderClient): Promise<Form155BuildResult> {
  const { data: deal } = await sb.from("deals").select("id, name, loan_amount, borrower_id").eq("id", dealId).maybeSingle();

  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select(
      "requested_amount, seller_note_equity_portion, standby_creditor_name, standby_agreement_option, " +
        "note_interest_rate, note_date, standby_note_interest_amount",
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sellerNoteEquityPortion = (loanRequest as { seller_note_equity_portion?: number } | null)?.seller_note_equity_portion ?? 0;
  const applicable = (sellerNoteEquityPortion ?? 0) > 0;

  if (!applicable) {
    return buildForm155({ applicable: false, fields: {}, borrowerOwnershipEntityId: null });
  }

  const borrowerId = (deal as { borrower_id?: string } | null)?.borrower_id ?? null;
  const { data: borrower } = borrowerId ? await sb.from("borrowers").select("legal_name").eq("id", borrowerId).maybeSingle() : { data: null };

  const { data: bank } = await sb.from("banks").select("name").eq("id", bankId).maybeSingle();

  const { data: sbaLoan } = await sb.from("sba_loans").select("loan_number").eq("deal_id", dealId).maybeSingle();

  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select("id, entity_type, ownership_pct")
    .eq("deal_id", dealId);

  const individualOwners = ((ownershipEntities ?? []) as Array<{ id: string; entity_type: string | null; ownership_pct: number | null }>)
    .filter((e) => e.entity_type === "individual" || e.entity_type === "person")
    .sort((a, b) => (b.ownership_pct ?? 0) - (a.ownership_pct ?? 0));
  const borrowerOwnershipEntityId = individualOwners[0]?.id ?? null;

  const lr = loanRequest as Record<string, any> | null;
  const borrowerLegalName = (borrower as { legal_name?: string } | null)?.legal_name ?? null;
  const agreeOption = lr?.standby_agreement_option ?? null;

  const fields: Form155Input = {
    sba_loan_number: (sbaLoan as { loan_number?: string } | null)?.loan_number ?? null,
    sba_loan_name: (deal as { name?: string } | null)?.name ?? borrowerLegalName,
    standby_borrower_name: borrowerLegalName,
    standby_creditor_name: lr?.standby_creditor_name ?? null,
    lender_name: (bank as { name?: string } | null)?.name ?? null,
    note_principal_amount: sellerNoteEquityPortion,
    note_interest_amount: lr?.standby_note_interest_amount ?? null,
    lenders_loan_amount: lr?.requested_amount ?? (deal as { loan_amount?: number } | null)?.loan_amount ?? null,
    agree_option: agreeOption,
    agree_option_2_rate: agreeOption === "2" ? lr?.note_interest_rate ?? null : null,
    agree_option_3_rate: agreeOption === "3" ? lr?.note_interest_rate ?? null : null,
    agree_option_4_rate: agreeOption === "4" ? lr?.note_interest_rate ?? null : null,
    agree_option_4_start_date: agreeOption === "4" ? lr?.note_date ?? null : null,
    // Best-effort default: the form's printed-name line is whoever signs
    // on the standby creditor's behalf, which this schema doesn't
    // separately track — the creditor's own name is a reasonable default
    // (exact for an individual standby creditor) rather than leaving it
    // blank. See render.ts.
    print_name: lr?.standby_creditor_name ?? null,
  };

  return buildForm155({ applicable: true, fields, borrowerOwnershipEntityId });
}
