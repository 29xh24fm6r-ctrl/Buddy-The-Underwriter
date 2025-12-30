import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * HARD RULE:
 * - Never protect /api/** in middleware.
 *   API routes must return JSON 401/403 and must be curl/automation-friendly.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/pricing(.*)",
  "/borrower-portal(.*)",
  "/upload(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

export default clerkMiddleware((auth, req) => {
  const p = req.nextUrl.pathname;

  // ✅ ABSOLUTE BYPASS FOR API
  if (p === "/api" || p.startsWith("/api/") || p === "/trpc" || p.startsWith("/trpc/")) {
    return;
  }

  if (isPublicRoute(req)) return;

  auth().protect();
});

export const config = {
  matcher: [
    // Run on everything except static assets
    "/((?!_next|.*\\..*).*)",
  ],
};
