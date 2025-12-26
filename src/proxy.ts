import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Program-wide enforcement:
 * Only allow the Stitch "universe" routes.
 * Everything else redirects to /deals.
 */
const ALLOW_PREFIXES = [
  "/deals",
  "/portal",
  "/borrower",
  "/borrowers",
  "/admin",
  "/share",
  "/s",
  "/sign-in",
  "/sign-up",

  // HeroBar + app routes
  "/documents",
  "/underwrite",
  "/pricing",
  "/credit-memo",
  "/servicing",
  "/command",
  "/settings",
    "/debug",
  "/borrower-portal",
];


function isAllowed(pathname: string) {
  // Always allow Next internals + APIs + common static files
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) return true;

  return ALLOW_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export default clerkMiddleware((auth, req) => {
  const { pathname } = req.nextUrl;

  // If not allowed, hard-redirect into the Stitch universe.
  if (!isAllowed(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/deals";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$).*)", "/(api|trpc)(.*)"],
};
