import "server-only";

/**
 * Atomic-RPC error code -> HTTP status mapping for the marketplace claim and
 * pick flows. The RPCs raise PostgreSQL exceptions with the codes below;
 * the route handlers extract the code from the error message and use this
 * table to return the right HTTP status.
 */
export const MARKETPLACE_CLAIM_ERROR_STATUS: Record<string, number> = {
  listing_not_found: 404,
  listing_not_open: 409,
  claim_cap_reached: 409,
  duplicate_claim: 409,
  not_matched: 403,
  winner_has_no_claim: 409,
  listing_not_pickable: 409,
};

export function classifyMarketplaceError(rawMessage: string | null | undefined): {
  code: string;
  status: number;
} {
  const code = rawMessage?.match(/[a-z_]+/)?.[0] ?? "marketplace_rpc_failed";
  const status = MARKETPLACE_CLAIM_ERROR_STATUS[code] ?? 500;
  return { code, status };
}
