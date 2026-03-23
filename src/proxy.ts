// src/proxy.ts — Next.js 16 middleware

// NEVER use clerkMiddleware here — it calls Clerk BAPI on cold start and hangs → 504.

// JWT validation happens in route handlers via clerkAuth().

import { NextRequest, NextResponse } from "next/server";

const PUBLIC_EXACT = new Set(["/", "/pricing", "/borrower-portal", "/upload", "/sign-in", "/sign-up"]);

const PUBLIC_PREFIXES = ["/pricing/", "/borrower-portal/", "/upload/", "/sign-in/", "/sign-up/"];

const E2E_BYPASS_PATHS = new Set(["/", "/deals", "/analytics", "/portfolio", "/intake", "/borrower/portal", "/underwrite"]);

const E2E_BYPASS_PREFIXES = ["/underwrite/", "/deals/", "/credit-memo/"];

function isPublicRoute(pathname: string): boolean {
    if (PUBLIC_EXACT.has(pathname)) return true;
    return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function withBuildHeader(): NextResponse {
    const res = NextResponse.next();
    const build = process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "unknown";
    res.headers.set("x-buddy-build", build);
    if (process.env.NODE_ENV !== "production" || process.env.BUDDY_INTERNAL_FORCE === "true") {
          res.headers.set("x-buddy-internal", "true");
    }
    return res;
}

function hasClerkSession(req: NextRequest): boolean {
    return !!(req.cookies.get("__session")?.value || req.cookies.get("__client_uat")?.value);
}

export default function proxy(req: NextRequest): NextResponse {
    const p = req.nextUrl.pathname;

  // E2E bypass (never in production)
  if (process.env.E2E === "1" && process.env.PLAYWRIGHT === "1" && process.env.NODE_ENV !== "production") {
        const match = E2E_BYPASS_PATHS.has(p) || E2E_BYPASS_PREFIXES.some((prefix) => p.startsWith(prefix));
        if (match) {
                const isUnderwrite = p.startsWith("/underwrite/") || /\/deals\/[^/]+\/underwrite/.test(p);
                return new NextResponse(
                          `<!doctype html><html><body>E2E OK: ${p}${isUnderwrite ? " | controls: documents, checklist-request, recommendation-primary" : ""}</body></html>`,
                  { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
                        );
        }
  }

  // API + tRPC: always pass through, never auth-gated in middleware
  if (p === "/api" || p.startsWith("/api/") || p === "/trpc" || p.startsWith("/trpc/")) {
        return NextResponse.next();
  }

  // Public routes: instant response
  if (isPublicRoute(p)) return withBuildHeader();

  // Protected routes: fast cookie check. Full JWT validation in route handlers.
  if (!hasClerkSession(req)) {
        const signInUrl = new URL("/sign-in", req.url);
        signInUrl.searchParams.set("redirect_url", p + req.nextUrl.search);
        return NextResponse.redirect(signInUrl);
  }

  return withBuildHeader();
}

export const config = {
    matcher: ["/((?!_next|api/workers/|.*\\..*).*)" ],
};
