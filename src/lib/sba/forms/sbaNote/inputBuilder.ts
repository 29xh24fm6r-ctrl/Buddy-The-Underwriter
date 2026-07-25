import { buildSbaNote, type SbaNoteBuildResult } from "@/lib/sba/forms/sbaNote/build";

export type SbaNoteInputBuilderClient = { from: (table: string) => any };

function isIndividual(entityType: string | null | undefined): boolean {
  return entityType === "individual" || entityType === "person";
}

function summarizeUseOfProceeds(raw: unknown, fallbackPurpose: string | null): string | null {
  if (Array.isArray(raw) && raw.length > 0) {
    const parts = raw
      .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
      .map((r) => {
        const category = typeof r.category === "string" ? r.category : null;
        const amount = typeof r.amount === "number" ? r.amount : null;
        return [category, amount != null ? `$${amount.toLocaleString("en-US")}` : null].filter(Boolean).join(" — ");
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join("; ");
  }
  return fallbackPurpose;
}

/**
 * Deal-level, single-signer document — same borrower-signer resolution as
 * form601/form155 (largest individual owner by ownership_pct). Note terms
 * come from the underwriting decision fields on deal_loan_requests
 * (approved_amount/approved_rate_pct/approved_term_months/
 * approved_amort_months) — NOT note_interest_rate/note_date, which per
 * their migration comment are Form 155's standby/seller-note fields, a
 * different instrument entirely.
 */
export async function buildSbaNoteInput(dealId: string, bankId: string, sb: SbaNoteInputBuilderClient): Promise<SbaNoteBuildResult> {
  const { data: deal } = await sb.from("deals").select("id, name, borrower_id").eq("id", dealId).maybeSingle();
  const borrowerId = (deal as { borrower_id?: string } | null)?.borrower_id ?? null;
  const { data: borrower } = borrowerId
    ? await sb.from("borrowers").select("legal_name").eq("id", borrowerId).maybeSingle()
    : { data: null };
  const { data: bank } = await sb.from("banks").select("name").eq("id", bankId).maybeSingle();

  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select(
      "approved_amount, approved_rate_pct, approved_term_months, approved_amort_months, " +
        "requested_interest_only_months, requested_rate_type, requested_rate_index, requested_spread_bps, " +
        "payment_frequency, use_of_proceeds, purpose, late_charge_override_text, prepayment_penalty_override_text",
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lr = (loanRequest ?? {}) as Record<string, unknown>;

  const { data: ownershipEntities } = await sb
    .from("ownership_entities")
    .select("id, entity_type, ownership_pct")
    .eq("deal_id", dealId);
  const individualOwners = ((ownershipEntities ?? []) as Array<{ id: string; entity_type: string | null; ownership_pct: number | null }>)
    .filter((e) => isIndividual(e.entity_type))
    .sort((a, b) => (b.ownership_pct ?? 0) - (a.ownership_pct ?? 0));
  const borrowerOwnershipEntityId = individualOwners[0]?.id ?? null;

  const { data: participations } = await sb
    .from("deal_entity_participations")
    .select("role_key, guaranty_type, title, ownership_entity_id")
    .eq("deal_id", dealId)
    .eq("role_key", "guarantor");
  const guarantors = ((participations ?? []) as Array<{ title: string | null; guaranty_type: string | null }>).map((p) => ({
    name: p.title ?? "Guarantor",
    type: p.guaranty_type ?? null,
  }));

  const { data: collateralItems } = await sb
    .from("deal_collateral_items")
    .select("description, collateral_type")
    .eq("deal_id", dealId);
  const collateralSummary = ((collateralItems ?? []) as Array<{ description: string | null; collateral_type: string | null }>)
    .map((c) => c.description || c.collateral_type)
    .filter((s): s is string => Boolean(s));

  return buildSbaNote({
    fields: {
      borrower_legal_name: (borrower as { legal_name?: string } | null)?.legal_name ?? (deal as { name?: string } | null)?.name ?? null,
      lender_name: (bank as { name?: string } | null)?.name ?? null,
      lender_address: null,
      principal_amount: (lr.approved_amount as number | null) ?? null,
      interest_rate_pct: (lr.approved_rate_pct as number | null) ?? null,
      rate_type: ((lr.requested_rate_type as string | null)?.toLowerCase() as "fixed" | "variable" | null) ?? null,
      rate_index: (lr.requested_rate_index as string | null) ?? null,
      rate_spread_bps: (lr.requested_spread_bps as number | null) ?? null,
      term_months: (lr.approved_term_months as number | null) ?? null,
      amort_months: (lr.approved_amort_months as number | null) ?? null,
      interest_only_months: (lr.requested_interest_only_months as number | null) ?? null,
      payment_frequency: (lr.payment_frequency as string | null) ?? "monthly",
      use_of_proceeds_summary: summarizeUseOfProceeds(lr.use_of_proceeds, (lr.purpose as string | null) ?? null),
      collateral_summary: collateralSummary,
      guarantors,
    },
    lateChargeOverrideText: (lr.late_charge_override_text as string | null) ?? null,
    prepaymentPenaltyOverrideText: (lr.prepayment_penalty_override_text as string | null) ?? null,
    borrowerOwnershipEntityId,
  });
}
