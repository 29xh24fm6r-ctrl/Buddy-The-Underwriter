/**
 * getTestContext — Detect safe test mode
 * 
 * Rules:
 * 1. Only enabled for internal users
 * 2. Never shown to borrowers
 * 3. Requires ?__mode=test in URL
 * 4. Server-side only
 * 
 * Usage:
 *   const isTestMode = getTestContext(req);
 *   if (isTestMode) {
 *     // Allow test control panel
 *   }
 */

export function getTestContext(req: Request): boolean {
  // Check internal header (set by middleware or auth)
  const isInternal = req.headers.get("x-buddy-internal") === "true";

  // Check URL param
  const url = new URL(req.url);
  const testMode = url.searchParams.get("__mode") === "test";

  // Both must be true
  return isInternal && testMode;
}

/**
 * For client-side test context detection
 * (use sparingly - prefer server-side)
 */
export function getClientTestContext(): boolean {
  if (typeof window === "undefined") return false;

  const params = new URLSearchParams(window.location.search);
  return params.get("__mode") === "test";
}
