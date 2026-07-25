import { buildLoanAuthorization, type LoanAuthorizationBuildResult } from "@/lib/sba/forms/loanAuthorization/build";

export type LoanAuthorizationInputBuilderClient = { from: (table: string) => any };

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
 * Same deal-level, single-signer shape and terms source as sbaNote/
 * inputBuilder.ts — the Authorization and the Note describe the same
 * loan, so they're built from the same underwriting-decision fields.
 * Covenants come from deal_covenants (the table
 * src/lib/closing/render/buildClosingRenderSnapshot.ts also reads), not
 * the separate buddy_covenant_packages narrative representation — see
 * this arc's plan doc for why.
 */
export async function buildLoanAuthorizationInput(
  dealId: string,
  bankId: string,
  sb: LoanAuthorizationInputBuilderClient,
): Promise<LoanAuthorizationBuildResult> {
  const { data: deal } = await sb.from("deals").select("id, name, borrower_id").eq("id", dealId).maybeSingle();
  const borrowerId = (deal as { borrower_id?: string } | null)?.borrower_id ?? null;
  const { data: borrower } = borrowerId
    ? await sb.from("borrowers").select("legal_name").eq("id", borrowerId).maybeSingle()
    : { data: null };
  const { data: bank } = await sb.from("banks").select("name").eq("id", bankId).maybeSingle();

  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select("approved_amount, approved_rate_pct, approved_term_months, requested_rate_type, use_of_proceeds, purpose")
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
    .select("title, guaranty_type")
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

  const { data: covenantRows } = await sb
    .from("deal_covenants")
    .select("metric, threshold, testing_frequency")
    .eq("deal_id", dealId)
    .in("status", ["approved", "active"]);
  const dealCovenants = ((covenantRows ?? []) as Array<{ metric: string; threshold: string; testing_frequency: string }>).map((c) => ({
    metric: c.metric,
    threshold: c.threshold,
    testing_frequency: c.testing_frequency,
  }));

  return buildLoanAuthorization({
    fields: {
      borrower_legal_name: (borrower as { legal_name?: string } | null)?.legal_name ?? (deal as { name?: string } | null)?.name ?? null,
      lender_name: (bank as { name?: string } | null)?.name ?? null,
      principal_amount: (lr.approved_amount as number | null) ?? null,
      interest_rate_pct: (lr.approved_rate_pct as number | null) ?? null,
      rate_type: ((lr.requested_rate_type as string | null)?.toLowerCase() as "fixed" | "variable" | null) ?? null,
      term_months: (lr.approved_term_months as number | null) ?? null,
      use_of_proceeds_summary: summarizeUseOfProceeds(lr.use_of_proceeds, (lr.purpose as string | null) ?? null),
      collateral_summary: collateralSummary,
      guarantors,
      deal_covenants: dealCovenants,
    },
    borrowerOwnershipEntityId,
  });
}
