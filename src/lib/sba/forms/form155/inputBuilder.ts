import type { Form155BuildResult, Form155Input } from "@/lib/sba/forms/form155/build";
import { buildForm155 } from "@/lib/sba/forms/form155/build";

export type Form155InputBuilderClient = { from: (table: string) => any };

/**
 * SPEC S4 G-3 — applicable when `seller_note_equity_portion > 0` on the
 * latest deal_loan_requests row (per A-S4-4). Standby creditor (seller)
 * name/address have no source in canonical state (schema gap — see
 * build.ts's `standby_creditor_signable: false` docstring); those fields
 * stay null and surface through the normal missing-fields mechanism
 * rather than being fabricated.
 */
export async function buildForm155Input(dealId: string, bankId: string, sb: Form155InputBuilderClient): Promise<Form155BuildResult> {
  const { data: deal } = await sb.from("deals").select("id, loan_amount, borrower_id").eq("id", dealId).maybeSingle();

  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select("requested_amount, seller_note_equity_portion, seller_note_full_standby")
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

  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select("id, entity_type, ownership_pct")
    .eq("deal_id", dealId);

  const individualOwners = ((ownershipEntities ?? []) as Array<{ id: string; entity_type: string | null; ownership_pct: number | null }>)
    .filter((e) => e.entity_type === "individual" || e.entity_type === "person")
    .sort((a, b) => (b.ownership_pct ?? 0) - (a.ownership_pct ?? 0));
  const borrowerOwnershipEntityId = individualOwners[0]?.id ?? null;

  const fields: Form155Input = {
    borrower_legal_name: (borrower as { legal_name?: string } | null)?.legal_name ?? null,
    lender_name: (bank as { name?: string } | null)?.name ?? null,
    loan_amount:
      (loanRequest as { requested_amount?: number } | null)?.requested_amount ??
      (deal as { loan_amount?: number } | null)?.loan_amount ??
      null,
    standby_creditor_name: null,
    standby_creditor_address: null,
    note_principal_amount: sellerNoteEquityPortion,
    note_date: null,
    note_interest_rate: null,
    full_standby_for_loan_term: (loanRequest as { seller_note_full_standby?: boolean } | null)?.seller_note_full_standby ?? null,
    subordination_terms_acknowledged: null,
  };

  return buildForm155({ applicable: true, fields, borrowerOwnershipEntityId });
}
