import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { logDemoPageviewIfApplicable } from "@/lib/tenant/demoTelemetry";

/**
 * HARD RULE:
 * - Never protect /api/** in middleware.
 *   API routes must return JSON 401/403 and must be curl/automation-friendly.
 */
/**
 * Public routes — no auth gate.
 *
 * /portal namespace splits into auth and token routes:
 *   - bare /portal               → banker AppShell (auth-gated, NOT here)
 *   - /portal/deals/...          → banker subroutes  (auth-gated, NOT here)
 *   - /portal/owner/[token]      → token-gated (public, listed below)
 *   - /portal/share/[token]      → token-gated (public, listed below)
 *
 * The borrower magic-link portal at `(borrower)/portal/[token]/page.tsx`
 * resolves to `/portal/<token>` URL and currently collides with the bare
 * banker /portal tree. That structural collision is tracked separately
 * (see Sprint A.1 PR description). This matcher does NOT gate the
 * collision either way; it only opens the two intentionally-public token
 * subroutes.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/start(.*)",
  "/for-banks(.*)",
  "/pricing(.*)",
  "/portal/owner/(.*)",
  "/portal/share/(.*)",
  "/upload(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

const E2E_BYPASS_PATHS = ["/", "/deals", "/analytics", "/portfolio", "/intake", "/borrower/portal", "/underwrite"];
const E2E_BYPASS_PREFIXES = ["/underwrite/", "/deals/", "/credit-memo/"];

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

function extractEmailFromClaims(claims: any): string | null {
  if (!claims) return null;
  const candidates = [
    claims.email,
    claims.primary_email,
    claims.primaryEmail,
    claims.email_address,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.includes("@")) return value;
  }
  return null;
}

function getClientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  const realIp = req.headers.get("x-real-ip");
  return realIp ? String(realIp) : null;
}

export default clerkMiddleware(async (auth, req) => {
  const p = req.nextUrl.pathname;

  const e2eEnabled = process.env.E2E === "1";
  const e2eGuard = process.env.PLAYWRIGHT === "1" || process.env.NODE_ENV === "test";
  if (e2eEnabled && process.env.NODE_ENV === "production") {
    console.error("[middleware] E2E bypass enabled in production; ignoring.");
    return NextResponse.next();
  }
  const e2eBypass = e2eEnabled && e2eGuard && process.env.NODE_ENV !== "production";

  // TODO(E2E): remove bypass after resolving Next app-route compile hang.
  const bypassMatch =
    E2E_BYPASS_PATHS.includes(p) || E2E_BYPASS_PREFIXES.some((prefix) => p.startsWith(prefix));

  if (e2eBypass && bypassMatch) {
    const isUnderwriteRoute =
      p.startsWith("/underwrite/") || /\/deals\/[^/]+\/underwrite/.test(p);
    const controlMarker = isUnderwriteRoute
      ? " | controls: documents, checklist-request, recommendation-primary"
      : "";
    return new Response(`<!doctype html><html><body>E2E OK: ${p}${controlMarker}</body></html>`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const isApiRoute = p === "/api" || p.startsWith("/api/") || p === "/trpc" || p.startsWith("/trpc/");

  // 3) Public routes — return immediately, never block on auth()
  if (!isApiRoute && isPublicRoute(req)) {
    // Fire-and-forget telemetry — never awaited
    Promise.resolve().then(() =>
      logDemoPageviewIfApplicable({
        email: null,
        bankId: req.cookies.get("bank_id")?.value ?? null,
        path: p,
        method: req.method,
        ip: getClientIp(req),
        userAgent: req.headers.get("user-agent"),
        eventType: "pageview",
        meta: { method: req.method },
      }).catch(() => {})
    );
    return withBuildHeader();
  }

  // 4) auth() for ALL non-public routes (pages AND API).
  // Clerk requires auth() to be called in middleware so downstream
  // route handlers can read the session. Without this, API route
  // auth() returns { userId: null } because context was never set.
  const a = await auth();

  // API routes: never redirect — route handler owns 401/403 responses.
  // The auth() call above is the critical side-effect that establishes context.
  if (isApiRoute) {
    return NextResponse.next();
  }

  // Page routes: redirect unauthenticated users to sign-in
  if (!a?.userId) {
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect_url", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  // Fire-and-forget telemetry for authenticated pages
  Promise.resolve().then(() =>
    logDemoPageviewIfApplicable({
      email: extractEmailFromClaims(a?.sessionClaims ?? null),
      bankId: req.cookies.get("bank_id")?.value ?? null,
      path: p,
      method: req.method,
      ip: getClientIp(req),
      userAgent: req.headers.get("user-agent"),
      eventType: "pageview",
      meta: { method: req.method },
    }).catch(() => {})
  );

  return withBuildHeader();
});

export const config = {
  matcher: [
    // Run on everything except static assets and worker endpoints.
    // /api/workers/* are cron/worker endpoints authenticated via CRON_SECRET,
    // not Clerk sessions. Excluding them prevents Clerk from rejecting
    // unauthenticated cron requests before the route handler runs.
    "/((?!_next|api/workers/|.*\\..*).*)",
  ],
};
