import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Canonical Buddy auth gate.
 *
 * Public:
 *   - marketing + health
 *   - auth pages
 *   - share links
 *   - API health
 *
 * Protected:
 *   - everything else
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/health",
  "/api/health",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/s(.*)",
  "/share(.*)",
  "/stitch(.*)",        // keep stitch accessible for now; lock down later if desired
  "/stitch-login(.*)",
  "/stitch-results(.*)",
  "/stitch-share(.*)",
  "/stitch-generate(.*)",
]);

export default clerkMiddleware((auth, req) => {
  const { pathname } = req.nextUrl;

  // Always allow Next internals + static
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap.xml")
  ) {
    return NextResponse.next();
  }

  // Public routes flow through
  if (isPublicRoute(req)) return NextResponse.next();

  // Everything else requires auth
  auth().protect();
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$).*)", "/(api|trpc)(.*)"],
};
