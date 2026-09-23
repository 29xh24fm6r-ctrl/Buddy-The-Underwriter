import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { previewPackageFinancialSnapshot } from "@/lib/modelEngine/packageFinancialSnapshot";
import { computeTridentInputSnapshot } from "./trident/tridentInputSnapshot";
import { assertPackageDeterministicReadiness } from "./trident/packagePreflight";
import { packageRecoveryItems } from "@/lib/borrower/guidedPackage/packageRecovery";
import type { BorrowerPackageCheck } from "./borrowerPackageCheckState";

/** Compare actual line items, not just totals: category changes affect projections. */
export function samePackageProceeds(saved: unknown, canonical: unknown): boolean {
  const normalize = (value: unknown) => {
    if (!Array.isArray(value)) return null;
    const rows: string[] = [];
    for (const row of value) {
      if (!row || typeof row.category !== "string" || !["number", "string"].includes(typeof row.amount) || row.amount === "" || !Number.isFinite(Number(row.amount)) || Number(row.amount) < 0) return null;
      if (Number(row.amount) > 0) rows.push(JSON.stringify([row.category, row.description ?? "", Number(row.amount)]));
    }
    return rows.sort();
  };
  const current = normalize(canonical);
  if (!current?.length) return false;
  if (saved == null || (Array.isArray(saved) && saved.length === 0)) return true;
  if (!Array.isArray(saved) || saved.length > 100 || saved.some(row => !row || typeof row.amount !== "number")) return false;
  const desired = normalize(saved);
  return desired !== null && JSON.stringify(desired) === JSON.stringify(current);
}

/** Read-only, on demand. Reuses the factory's model, memo and feasibility checks.
 * Missing preparation outputs are reported as unchecked, never as a pass. */
export async function checkBorrowerPackageEvidence(dealId: string, bankId: string, isTest: boolean): Promise<BorrowerPackageCheck> {
  const sb = supabaseAdmin();
  const result = (status: BorrowerPackageCheck["status"], message: string, recoveryItems: BorrowerPackageCheck["recoveryItems"] = []): BorrowerPackageCheck => ({ checkedAt: new Date().toISOString(), status, message, recoveryItems });
  try {
    const deal = await sb.from("deals").select("id").eq("id", dealId).eq("bank_id", bankId).maybeSingle();
    if (deal.error || !deal.data) throw new Error("deal_unavailable");
    const before = await computeTridentInputSnapshot(sb, dealId);
    const [loan, proceeds] = await Promise.all([
      sb.from("deal_loan_requests").select("use_of_proceeds").eq("deal_id", dealId).eq("bank_id", bankId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("deal_proceeds_items").select("category,description,amount").eq("deal_id", dealId),
    ]);
    if (loan.error || proceeds.error) throw new Error("proceeds_read_failed");
    if (!samePackageProceeds(loan.data?.use_of_proceeds, proceeds.data)) return result("not_checked",
      "Your saved project costs have not yet been reconciled with the financing schedule. Package preparation must reconcile them before these calculations can be checked.");
    const snapshot = await previewPackageFinancialSnapshot({ dealId, bankId });
    await assertPackageDeterministicReadiness(snapshot);
    const after = await computeTridentInputSnapshot(sb, dealId);
    if (before.inputHash !== after.inputHash) throw new Error("input_snapshot_changed");
    return result("passed", "Saved financial calculations, credit memo inputs and feasibility evidence passed the current checks. Generated documents and final approval have not been verified.");
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    if (text.includes("input_snapshot_changed")) return result("not_checked", "Your saved information changed during the check. Refresh and check again.");
    if (text.includes("preparing-to-open answer conflicts with operating history")) return result("blocked",
      "Your preparing-to-open answer conflicts with business financial history. Review the business stage and source documents. Personal tax returns do not establish business operating history.",
      [{ id: "business-stage", questionId: "B07", label: "Review whether this business is already operating or preparing to open." }]);
    const recovery = packageRecoveryItems(text, isTest);
    return result("blocked", recovery.length
      ? "Saved package evidence needs attention. Review the findings below."
      : "Saved package evidence could not pass the checks. Review your financial documents and confirmed assumptions; if no missing details are shown, contact Buddy support.", recovery);
  }
}
