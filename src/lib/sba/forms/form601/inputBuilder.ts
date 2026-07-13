import type { Form601BuildResult, Form601Input } from "@/lib/sba/forms/form601/build";
import { buildForm601 } from "@/lib/sba/forms/form601/build";

export type Form601InputBuilderClient = { from: (table: string) => any };

const CONSTRUCTION_PATTERN = /construction|renovat|build[- ]?out|tenant improvement/i;
const CONSTRUCTION_THRESHOLD = 10_000;

type UseOfProceedsLine = { category?: string | null; description?: string | null; amount?: number | null };

function parseUseOfProceeds(raw: unknown): UseOfProceedsLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is UseOfProceedsLine => typeof r === "object" && r !== null);
}

type PropertyAddress = { street?: string; city?: string; state?: string; zip?: string } | null;

/**
 * SPEC S7 (ARC-00 Phase 5) — applicable when use-of-proceeds construction
 * line items sum to more than $10,000, matching the spec's stated
 * threshold. Same borrower-signer resolution as form155/inputBuilder.ts
 * (largest individual owner by ownership_pct).
 */
export async function buildForm601Input(dealId: string, bankId: string, sb: Form601InputBuilderClient): Promise<Form601BuildResult> {
  const { data: deal } = await sb.from("deals").select("id, borrower_id").eq("id", dealId).maybeSingle();

  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select("use_of_proceeds, property_address_json")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const uopLines = parseUseOfProceeds((loanRequest as { use_of_proceeds?: unknown } | null)?.use_of_proceeds);
  const constructionAmount = uopLines
    .filter((l) => (l.category && CONSTRUCTION_PATTERN.test(l.category)) || (l.description && CONSTRUCTION_PATTERN.test(l.description)))
    .reduce((sum, l) => sum + (l.amount ?? 0), 0);

  const applicable = constructionAmount > CONSTRUCTION_THRESHOLD;

  if (!applicable) {
    return buildForm601({ applicable: false, fields: {}, borrowerOwnershipEntityId: null });
  }

  const borrowerId = (deal as { borrower_id?: string } | null)?.borrower_id ?? null;
  const { data: borrower } = borrowerId ? await sb.from("borrowers").select("legal_name").eq("id", borrowerId).maybeSingle() : { data: null };
  const { data: bank } = await sb.from("banks").select("name").eq("id", bankId).maybeSingle();

  const { data: ownershipEntities } = await sb.from("ownership_entities").select("id, entity_type, ownership_pct").eq("deal_id", dealId);
  const individualOwners = ((ownershipEntities ?? []) as Array<{ id: string; entity_type: string | null; ownership_pct: number | null }>)
    .filter((e) => e.entity_type === "individual" || e.entity_type === "person")
    .sort((a, b) => (b.ownership_pct ?? 0) - (a.ownership_pct ?? 0));
  const borrowerOwnershipEntityId = individualOwners[0]?.id ?? null;

  const projectAddress = ((loanRequest as { property_address_json?: unknown } | null)?.property_address_json ?? null) as PropertyAddress;

  const fields: Form601Input = {
    borrower_legal_name: (borrower as { legal_name?: string } | null)?.legal_name ?? null,
    lender_name: (bank as { name?: string } | null)?.name ?? null,
    project_address_street: projectAddress?.street ?? null,
    project_address_city: projectAddress?.city ?? null,
    project_address_state: projectAddress?.state ?? null,
    project_address_zip: projectAddress?.zip ?? null,
    construction_amount: constructionAmount,
    contractor_name: null,
    compliance_certification_acknowledged: null,
  };

  return buildForm601({ applicable: true, fields, borrowerOwnershipEntityId });
}
