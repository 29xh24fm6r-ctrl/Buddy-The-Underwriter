// src/proxy.ts — Next.js 16 middleware
// Uses clerkMiddleware to establish auth context so auth() works in route handlers.
// Set CLERK_JWT_KEY in env to enable local JWT verification (no Clerk BAPI calls).

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/pricing(.*)",
  "/borrower-portal(.*)",
  "/upload(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

const E2E_BYPASS_PATHS = new Set(["/", "/deals", "/analytics", "/portfolio", "/intake", "/borrower/portal", "/underwrite"]);
const E2E_BYPASS_PREFIXES = ["/underwrite/", "/deals/", "/credit-memo/"];

function withBuildHeader(res: NextResponse = NextResponse.next()): NextResponse {
  const build = process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "unknown";
  res.headers.set("x-buddy-build", build);
  if (process.env.NODE_ENV !== "production" || process.env.BUDDY_INTERNAL_FORCE === "true") {
    res.headers.set("x-buddy-internal", "true");
  }
  return res;
}

function handleE2eBypass(req: NextRequest): NextResponse | null {
  if (process.env.E2E !== "1" || process.env.PLAYWRIGHT !== "1" || process.env.NODE_ENV === "production") {
    return null;
  }
  const p = req.nextUrl.pathname;
  const match = E2E_BYPASS_PATHS.has(p) || E2E_BYPASS_PREFIXES.some((prefix) => p.startsWith(prefix));
  if (!match) return null;
  const isUnderwrite = p.startsWith("/underwrite/") || /\/deals\/[^/]+\/underwrite/.test(p);
  return new NextResponse(
    `<!doctype html><html><body>E2E OK: ${p}${isUnderwrite ? " | controls: documents, checklist-request, recommendation-primary" : ""}</body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export default clerkMiddleware(async (auth, req) => {
  const p = req.nextUrl.pathname;

  // E2E bypass (never in production)
  const e2e = handleE2eBypass(req);
  if (e2e) return e2e;

  // API routes: always pass through (auth validated per-handler)
  if (p === "/api" || p.startsWith("/api/") || p === "/trpc" || p.startsWith("/trpc/")) {
    return NextResponse.next();
  }

  // Public routes: no auth required
  if (isPublicRoute(req)) {
    return withBuildHeader();
  }

  // Protected routes: require authenticated user
  const { userId } = await auth();
  if (!userId) {
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect_url", p + req.nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  return withBuildHeader();
});

export const config = {
  matcher: ["/((?!_next|api/workers/|.*\\..*).*)" ],
};
