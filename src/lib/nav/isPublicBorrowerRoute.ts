/**
 * Centralized list of route prefixes that must NEVER render banker / global
 * chrome (HeroBar, BuddyPanel, ProfileCompletionBanner, observer widgets).
 *
 * Mirrors the public-route matcher in src/proxy.ts so chrome decisions stay
 * coherent with auth decisions: a path that doesn't require auth must not
 * fetch profile-bound chrome (which itself 404s when unauthenticated).
 *
 * Banker /portal preserves chrome — only the token-gated sub-routes
 * (/portal/owner/[token], /portal/share/[token]) are listed here.
 */
const PUBLIC_BORROWER_PREFIXES = [
  "/start",
  "/for-banks",
  "/pricing",
  "/upload",
  "/sign-in",
  "/sign-up",
  "/share",
  "/stitch-share",
  "/stitch",
  "/portal/owner",
  "/portal/share",
];

export function isPublicBorrowerRoute(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) return false;
  if (pathname === "/") return true;
  return PUBLIC_BORROWER_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
