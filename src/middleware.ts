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
  const { pathname, searchParams } = req.nextUrl;

  // Allow Next internals + static
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    return NextResponse.next();
  }

  // Skip Vercel bypass logic for API routes (they use headers, not cookies)
  if (pathname.startsWith("/api/")) {
    if (isPublicRoute(req)) return NextResponse.next();
    await auth.protect();
    return NextResponse.next();
  }

  // Vercel Deployment Protection Auto-Bypass
  // Only run in preview environments with VERCEL_AUTOMATION_BYPASS_SECRET set
  const bypassToken = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const isPreview = process.env.VERCEL_ENV === "preview";
  
  if (isPreview && bypassToken) {
    // Check if user already has Vercel bypass cookie
    const hasBypassCookie = 
      req.cookies.get("_vercel_protection_bypass") ||
      req.cookies.get("_vercel_jwt") ||
      req.cookies.get("_vercel_sso_nonce");

    // Check if this is the redirect callback (to prevent loops)
    const isSettingBypass = searchParams.get("x-vercel-set-bypass-cookie") === "true";

    // If no bypass cookie and not currently setting it, redirect to set it
    if (!hasBypassCookie && !isSettingBypass) {
      const url = req.nextUrl.clone();
      url.searchParams.set("x-vercel-set-bypass-cookie", "true");
      url.searchParams.set("x-vercel-protection-bypass", bypassToken);
      
      console.log("[middleware] Setting Vercel bypass cookie for:", pathname);
      return NextResponse.redirect(url);
    }

    // If we just set the bypass, redirect back to clean URL
    if (isSettingBypass) {
      const url = req.nextUrl.clone();
      url.searchParams.delete("x-vercel-set-bypass-cookie");
      url.searchParams.delete("x-vercel-protection-bypass");
      
      console.log("[middleware] Vercel bypass cookie set, redirecting to clean URL:", pathname);
      return NextResponse.redirect(url);
    }
  }

  if (isPublicRoute(req)) return NextResponse.next();

  await auth.protect();
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$).*)", "/(api|trpc)(.*)"],
};
