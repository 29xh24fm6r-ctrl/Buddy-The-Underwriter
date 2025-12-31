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
  return res;
}

export default clerkMiddleware(async (auth, req) => {
  const p = req.nextUrl.pathname;

  // ✅ ABSOLUTE BYPASS FOR API
  if (p === "/api" || p.startsWith("/api/") || p === "/trpc" || p.startsWith("/trpc/")) {
    return withBuildHeader();
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
