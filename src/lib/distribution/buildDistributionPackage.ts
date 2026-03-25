/**
 * Build one canonical distribution package from approved state.
 * Composes borrower, banker, and relationship sub-packages.
 * Pure module — no DB, no server-only.
 */

import type { DistributionPackage } from "./types";
import type { BorrowerPackageInput } from "./buildBorrowerDistributionPackage";
import type { BankerPackageInput } from "./buildBankerDistributionPackage";
import type { RelationshipPackageInput } from "./buildRelationshipDistributionPackage";
import { buildBorrowerDistributionPackage } from "./buildBorrowerDistributionPackage";
import { buildBankerDistributionPackage } from "./buildBankerDistributionPackage";
import { buildRelationshipDistributionPackage } from "./buildRelationshipDistributionPackage";

export type DistributionPackageInput = {
  deal_id: string;
  generated_by?: string | null;

  // From approved freeze (53B)
  approved_structure_snapshot: Record<string, unknown>;
  approved_exceptions_snapshot: unknown[];
  approved_mitigants_snapshot: string[];

  source_freeze_id: string;
  source_committee_decision_id?: string | null;
  source_memo_snapshot_id?: string | null;

  // Sub-package inputs
  borrower: BorrowerPackageInput;
  banker: BankerPackageInput;
  relationship: RelationshipPackageInput;
};

export function buildDistributionPackage(
  input: DistributionPackageInput,
): DistributionPackage {
  return {
    deal_id: input.deal_id,
    package_id: `dist_${input.deal_id}_${Date.now()}`,
    generated_at: new Date().toISOString(),
    generated_by: input.generated_by ?? null,

    approved_structure_snapshot: input.approved_structure_snapshot,
    approved_exceptions_snapshot: input.approved_exceptions_snapshot,
    approved_mitigants_snapshot: input.approved_mitigants_snapshot,

    borrower_package: buildBorrowerDistributionPackage(input.borrower),
    banker_package: buildBankerDistributionPackage(input.banker),
    relationship_package: buildRelationshipDistributionPackage(input.relationship),

    source_freeze_id: input.source_freeze_id,
    source_committee_decision_id: input.source_committee_decision_id,
    source_memo_snapshot_id: input.source_memo_snapshot_id,
  };
}
