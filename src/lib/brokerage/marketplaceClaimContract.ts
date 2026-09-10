export type MarketplaceClaimRpcResult = {
  claim: Record<string, unknown>;
  claimId: string;
};

/**
 * The live RPC returns the persisted claim state (`active`). Older RPC
 * versions returned an action result (`claimed`) or `{ ok: true }`.
 * All three shapes prove success only when they also carry a claim id.
 */
export function parseMarketplaceClaimRpcResponse(
  data: unknown,
): MarketplaceClaimRpcResult | null {
  const raw = Array.isArray(data) ? data[0] : data;
  if (!raw || typeof raw !== "object") return null;

  const claim = raw as Record<string, unknown>;
  const successful =
    claim.ok === true || claim.status === "claimed" || claim.status === "active";
  if (!successful || typeof claim.claim_id !== "string" || !claim.claim_id) {
    return null;
  }

  return { claim, claimId: claim.claim_id };
}
