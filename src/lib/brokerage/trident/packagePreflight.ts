import "server-only";
import type { PackageFinancialSnapshot } from "@/lib/modelEngine/packageFinancialSnapshot";
import { runMemoPreflight, formatPreflightFindings } from "@/lib/creditMemo/canonical/memoPreflight";
import { buildPreflightInput } from "@/lib/creditMemo/canonical/buildPreflightInput";
import { generateFeasibilityStudy } from "@/lib/feasibility/feasibilityEngine";
import { assertProjectionReconciliation } from "@/lib/sba/projectionReconciliation";

/** All deterministic artifact checks run before the canonical memo's first model call. */
export async function assertPackageDeterministicReadiness(snapshot: PackageFinancialSnapshot) {
  assertProjectionReconciliation(snapshot.output.projectionModel);
  const blockers: string[] = [];
  const memo = runMemoPreflight(buildPreflightInput(snapshot.output.canonicalMemo, snapshot.output.memoContractBlockers));
  if (!memo.ok) blockers.push(`Credit memo preflight blocked: ${formatPreflightFindings(memo.findings)}`);
  const feasibility = await generateFeasibilityStudy({ dealId: snapshot.dealId, bankId: snapshot.bankId, preflightSnapshot: snapshot });
  if (!feasibility.ok) blockers.push(feasibility.error ?? "Feasibility preflight blocked");
  if (blockers.length) throw new Error(`Package preflight blocked:\n${blockers.join("\n")}`);
}
