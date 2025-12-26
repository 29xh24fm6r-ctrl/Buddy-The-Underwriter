import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";


const STRICT_PROXY = process.env.NEXT_PUBLIC_STRICT_PROXY === "1";
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

  // Added to allow full app navigation
  "/",
  "/home",
  "/evidence",
  "/output",
  "/templates",
  "/workout",
  "/workout-legal",
  "/workout-committee",
  "/committee",
  "/compliance",
  "/stitch",
  "/stitch-share",
  "/stitch-generate",
  "/stitch-login",
  "/stitch-results",
  "/ai-lab",
  "/analytics",
  "/exceptions",
  "/generate",
  "/ops",
  "/portfolio",
  "/recovery",
  "/reo",
  "/roles",
  "/rules",
  "/select-bank",
  "/tenant",
  "/upload",
  "/voice",
  "/workload",
  "/upgrade",
  "/underwriting",

    // Added by page audit
    "/auth",
    "/banker",
    "/banks",
    "/clerk-test",
    "/credit",
    "/intake",
    "/ocr-review",
    "/ocr",
    "/_not-found",
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
  // If not allowed:
  // - STRICT_PROXY=1 => funnel to /deals
  // - default        => let Next handle it (proper 404s, less masking during dev)
  if (!isAllowed(pathname)) {
    if (STRICT_PROXY) {
      const url = req.nextUrl.clone();
      url.pathname = "/deals";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }
return NextResponse.next();
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$).*)", "/(api|trpc)(.*)"],
};
