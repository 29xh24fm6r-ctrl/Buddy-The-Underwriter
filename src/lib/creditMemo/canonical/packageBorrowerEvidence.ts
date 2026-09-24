import "server-only";
import { loadPackageBorrowerContext } from "@/lib/sba/packageBorrowerContext";

const numberOrNull = (value: unknown): number | null => {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Saved statements supplement governed financial facts. They do not certify
 * ongoing income, identity, franchise eligibility, or available cash at closing. */
export async function loadMemoBorrowerEvidence(sb: { from: (table: string) => any }, dealId: string, bankId: string) {
  // Includes the deal/bank authorization boundary before owner reads.
  const business = await loadPackageBorrowerContext(sb, dealId, bankId);
  const owners = await sb.from("ownership_entities").select("id,display_name,entity_type,ownership_pct").eq("deal_id", dealId);
  if (owners.error) throw new Error("memo_owner_evidence_unavailable");
  const ids = (owners.data ?? []).map((o: any) => o.id);
  const financials = ids.length ? await sb.from("borrower_applicant_financials")
    .select("applicant_id,liquid_assets,net_worth,income_salary,captured_at,updated_at")
    .in("applicant_id", ids) : { data: [] };
  if (financials.error) throw new Error("memo_owner_financials_unavailable");
  return {
    business,
    evidencePolicy: "Canonical owner roster and saved personal statements are borrower-supplied evidence, not verified guarantees or ongoing repayment income. An empty governed sponsor schedule does not mean these statements are absent. Cite the source and its limitations. Do not sum historical and stated income or assume it continues after opening. A planned equity contribution is not verified funding.",
    owners: (owners.data ?? []).map((owner: any) => {
      const row = financials.data?.find((f: any) => f.applicant_id === owner.id);
      return { ownerId: owner.id, name: owner.display_name ?? null, entityType: owner.entity_type ?? null,
        ownershipPct: numberOrNull(owner.ownership_pct), personalStatement: row ? {
          source: "borrower_applicant_financials", capturedAt: row.captured_at ?? null, updatedAt: row.updated_at ?? null,
          liquidAssets: numberOrNull(row.liquid_assets), netWorth: numberOrNull(row.net_worth),
          statedAnnualSalary: numberOrNull(row.income_salary), ongoingIncomeConfirmed: false,
        } : null };
    }),
  };
}
