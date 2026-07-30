/**
 * Host helpers shared by ClerkGate (client) and the edge middleware
 * (src/proxy.ts) so the auth-provider decision and the host-redirect decision
 * can never drift apart.
 *
 * This single deployment serves several custom domains (see the Vercel
 * project's domain list), but Clerk's production instance is registered to
 * app.buddytheunderwriter.com only. The hosts below are pure
 * marketing/borrower surfaces where clerk-js refuses to initialize
 * (domain-mismatch) — so ClerkGate never mounts <ClerkProvider> on them, and
 * the middleware bounces any auth-requiring route hit there over to the app
 * origin (mirrors the /go/admin gateway).
 */
export const CLERK_MARKETING_HOSTS = new Set([
  "buddysba.com",
  "www.buddysba.com",
  "buddybrokerage.com",
  "www.buddybrokerage.com",
  "buddytheunderwriter.com",
  "www.buddytheunderwriter.com",
]);

/** Canonical, Clerk-enabled application origin. */
export const APP_ORIGIN = "https://app.buddytheunderwriter.com";

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/:\d+$/, "");
}

/**
 * True for the marketing/borrower domains where Clerk can't run. Previews,
 * localhost, and app.buddytheunderwriter.com itself are NOT marketing hosts.
 */
export function isMarketingHost(hostname: string): boolean {
  return CLERK_MARKETING_HOSTS.has(normalizeHost(hostname));
}

/** True when the host can initialize Clerk (app domain, previews, localhost). */
export function isClerkHost(hostname: string): boolean {
  return !isMarketingHost(hostname);
}
