// Thin wrapper around buildFloridaArmorySnapshot. Lives in the submission
// module so callers can import "the memo output payload builder" without
// reaching into the snapshot module's internals.

import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";
import type { MemoReadinessContract } from "./evaluateMemoReadinessContract";
import { buildFloridaArmorySnapshot } from "@/lib/creditMemo/snapshot/buildFloridaArmorySnapshot";
import type {
  FloridaArmoryMemoSnapshot,
  FloridaArmorySource,
} from "@/lib/creditMemo/snapshot/types";

export function buildMemoOutput(args: {
  dealId: string;
  bankId: string;
  bankerId: string;
  memoVersion: number;
  inputHash: string;
  canonicalMemo: CanonicalCreditMemoV1;
  readinessContract: MemoReadinessContract;
  overrides: Record<string, unknown>;
  dataSources?: FloridaArmorySource[];
  submittedAt?: string;
  snapshotId?: string;
}): FloridaArmoryMemoSnapshot {
  return buildFloridaArmorySnapshot(args);
}
