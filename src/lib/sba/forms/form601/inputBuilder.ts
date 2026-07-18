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

function combineNameAddressPhone(name: unknown, street: unknown, city: unknown, state: unknown, zip: unknown, phone: unknown): string | null {
  const address = [street, [city, state].filter(Boolean).join(", "), zip].filter((p) => p != null && p !== "").join(", ");
  const parts = [name, address || null, phone].filter((p) => p != null && p !== "");
  return parts.length > 0 ? parts.join(" — ") : null;
}

/**
 * SPEC S7 (ARC-00 Phase 5) — applicable when use-of-proceeds construction
 * line items sum to more than $10,000, matching the spec's stated
 * threshold — the real form has no field for this dollar amount itself
 * (confirmed against docs/sba-forms/601-fields.json), only for the
 * applicant/contractor identity blocks. Same borrower-signer resolution
 * as form155/inputBuilder.ts (largest individual owner by ownership_pct).
 */
export async function buildForm601Input(dealId: string, bankId: string, sb: Form601InputBuilderClient): Promise<Form601BuildResult> {
  const { data: deal } = await sb.from("deals").select("id, borrower_id").eq("id", dealId).maybeSingle();

  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select("use_of_proceeds, contractor_name, contractor_address, contractor_phone, contractor_authorized_official")
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
  const { data: borrower } = borrowerId
    ? await sb.from("borrowers").select("legal_name, phone, address_line1, city, state, zip").eq("id", borrowerId).maybeSingle()
    : { data: null };

  const { data: ownershipEntities } = await sb.from("ownership_entities").select("id, entity_type, ownership_pct, display_name, title").eq("deal_id", dealId);
  const individualOwners = ((ownershipEntities ?? []) as Array<{ id: string; entity_type: string | null; ownership_pct: number | null; display_name: string | null; title: string | null }>)
    .filter((e) => e.entity_type === "individual" || e.entity_type === "person")
    .sort((a, b) => (b.ownership_pct ?? 0) - (a.ownership_pct ?? 0));
  const signer = individualOwners[0] ?? null;
  const borrowerOwnershipEntityId = signer?.id ?? null;

  const b = (borrower ?? {}) as Record<string, string | null | undefined>;
  const lr = (loanRequest ?? {}) as Record<string, string | null | undefined>;

  const fields: Form601Input = {
    applicant_name: b.legal_name ?? null,
    applicant_name_address_phone: combineNameAddressPhone(b.legal_name, b.address_line1, b.city, b.state, b.zip, b.phone),
    applicant_official_name_title: signer ? [signer.display_name, signer.title].filter(Boolean).join(", ") || null : null,
    general_contractor_name: lr.contractor_name ?? null,
    subrecipient_name_address_phone: combineNameAddressPhone(lr.contractor_name, lr.contractor_address, null, null, null, lr.contractor_phone),
    contractor_official_name_title: lr.contractor_authorized_official ?? null,
  };

  return buildForm601({ applicable: true, fields, borrowerOwnershipEntityId });
}
