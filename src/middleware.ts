import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Canonical auth gate.
 * Public routes are explicitly allowlisted.
 * Everything else is protected.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/pricing",
  "/health",
  "/api/health(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/s(.*)",
  "/share(.*)",
  "/api/public(.*)",
  // Keep Stitch public for now to prevent surprises; tighten later if desired.
  "/stitch(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;

  // Allow Next internals + static
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    return NextResponse.next();
  }

  if (isPublicRoute(req)) return NextResponse.next();

  await auth.protect();
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$).*)", "/(api|trpc)(.*)"],
};
