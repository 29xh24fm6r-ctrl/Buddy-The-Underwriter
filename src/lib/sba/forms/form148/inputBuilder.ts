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
 */
export async function buildForm148Input(dealId: string, bankId: string, sb: Form148InputBuilderClient): Promise<Form148Input> {
  const { data: deal } = await sb.from("deals").select("id, loan_amount, borrower_id").eq("id", dealId).maybeSingle();

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

  const loanAmount =
    (loanRequest as { requested_amount?: number } | null)?.requested_amount ??
    (deal as { loan_amount?: number } | null)?.loan_amount ??
    null;

  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select("id, entity_type, display_name, ownership_pct, home_address_street, home_address_city, home_address_state, home_address_zip")
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
        guarantor_address_street: entity.home_address_street ?? null,
        guarantor_address_city: entity.home_address_city ?? null,
        guarantor_address_state: entity.home_address_state ?? null,
        guarantor_address_zip: entity.home_address_zip ?? null,
        borrower_legal_name: (borrower as { legal_name?: string } | null)?.legal_name ?? null,
        lender_name: (bank as { name?: string } | null)?.name ?? null,
        loan_amount: loanAmount,
        ownership_pct: entity.ownership_pct ?? null,
        limited_guarantee_cap_amount: null,
      },
    }));

  return { signers };
}
