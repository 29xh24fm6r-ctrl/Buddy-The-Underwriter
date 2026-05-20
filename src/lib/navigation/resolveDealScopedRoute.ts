/**
 * Deal-scoped navigation resolver.
 *
 * Underwriting workflow links (Credit Memo, Pricing, Underwrite) must
 * always resolve to a specific deal. This helper determines the correct
 * href or signals that a deal picker is needed.
 */

export type DealScopedTarget =
  | "credit-memo"
  | "pricing"
  | "underwrite"
  | "spreads"
  | "committee"
  | "servicing";

export type DealScopedResolution = {
  /** Fully resolved href, or null when deal selection is required. */
  href: string | null;
  /** True when no deal context exists and the caller should show a picker. */
  requiresDealSelection: boolean;
};

const DEAL_ID_REGEX = /\/deals\/([0-9a-f-]{36})\b/i;

/** Extract dealId from a pathname like /deals/[uuid]/... */
export function extractDealIdFromPath(pathname: string): string | null {
  return pathname.match(DEAL_ID_REGEX)?.[1] ?? null;
}

const LAST_DEAL_KEY = "buddy:lastDealId";

/** Read the last active dealId from localStorage. SSR-safe. */
export function getLastDealId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(LAST_DEAL_KEY);
  } catch {
    return null;
  }
}

/** Persist the active dealId to localStorage. SSR-safe. */
export function setLastDealId(dealId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAST_DEAL_KEY, dealId);
  } catch {
    // quota exceeded or private browsing — non-fatal
  }
}

/**
 * Resolve a deal-scoped navigation target.
 *
 * Priority:
 *  1. dealId from current pathname
 *  2. explicitly provided lastDealId (e.g. from localStorage)
 *  3. null → requiresDealSelection = true
 */
export function resolveDealScopedRoute(args: {
  pathname: string;
  target: DealScopedTarget;
  lastDealId?: string | null;
}): DealScopedResolution {
  const fromPath = extractDealIdFromPath(args.pathname);

  if (fromPath) {
    return {
      href: `/deals/${fromPath}/${args.target}`,
      requiresDealSelection: false,
    };
  }

  if (args.lastDealId) {
    return {
      href: `/deals/${args.lastDealId}/${args.target}`,
      requiresDealSelection: false,
    };
  }

  return { href: null, requiresDealSelection: true };
}
