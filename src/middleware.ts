// src/middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Buddy Middleware Policy
 *
 * ✅ Allow /api/** through middleware protection
 *    - API routes enforce auth themselves and must return JSON 401/403
 *    - Prevents Clerk "protect-rewrite" to /404 which breaks POST/curl + automation
 *
 * ✅ Protect app pages
 */
const isPublicRoute = createRouteMatcher([
  "/", // marketing
  "/pricing(.*)",
  "/borrower-portal(.*)",
  "/upload(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/(.*)", // ✅ CRITICAL: do not protect API routes in middleware
]);

export default clerkMiddleware((auth, req) => {
  if (isPublicRoute(req)) return;

  // Everything else requires auth
  auth().protect();
});

export const config = {
  matcher: [
    // Run on all routes except static assets
    "/((?!_next|.*\\..*).*)",
    // Include API/trpc so /api/(.*) can be evaluated by isPublicRoute
    "/(api|trpc)(.*)",
  ],
};
