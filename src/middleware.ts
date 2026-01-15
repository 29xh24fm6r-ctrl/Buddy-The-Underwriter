import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

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

function withBuildHeader() {
  const res = NextResponse.next();
  const build =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    "unknown";
  res.headers.set("x-buddy-build", build);
  
  // INTERNAL TEST MODE HEADER
  // Adds x-buddy-internal=true for non-prod or when explicitly enabled
  const isProd = process.env.NODE_ENV === "production";
  const internalEnabled = !isProd || process.env.BUDDY_INTERNAL_FORCE === "true";
  if (internalEnabled) {
    res.headers.set("x-buddy-internal", "true");
  }
  
  return res;
}

export default clerkMiddleware(async (auth, req) => {
  const p = req.nextUrl.pathname;

  if (process.env.E2E === "1" && (p === "/" || p === "/deals" || p === "/analytics")) {
    return new Response(`<!doctype html><html><body>E2E OK: ${p}</body></html>`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // ✅ ABSOLUTE BYPASS FOR API
  if (p === "/api" || p.startsWith("/api/") || p === "/trpc" || p.startsWith("/trpc/")) {
    // NOTE: For API routes we must return a bare `next()` response.
    // Vercel's Next.js "Proxy" layer is sensitive here; adding headers can
    // interfere with routing to Node lambdas in some environments.
    return NextResponse.next();
  }

  if (isPublicRoute(req)) return withBuildHeader();

  await auth.protect();

  return withBuildHeader();
});

export const config = {
  matcher: [
    // Run on everything except static assets
    "/((?!_next|.*\\..*).*)",
  ],
};
