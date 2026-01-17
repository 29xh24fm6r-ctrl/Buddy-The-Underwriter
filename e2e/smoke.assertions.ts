/**
 * Minimal "bank-grade" asserts to prevent false greens.
 * If a route is expected to fully render, add a stable data-testid.
 *
 * Add more over time; keep it small to avoid flake.
 */
export const ROUTE_TESTIDS: Record<string, string> = {
  "/deals": "deals-page",
  "/deals/:dealId/cockpit": "deal-cockpit",
  "/deals/:dealId/pricing": "deal-pricing",
  "/deals/:dealId/readiness": "deal-readiness",
  "/banker/dashboard": "banker-dashboard",
};
