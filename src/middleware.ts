// middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Routes that require authentication
const isProtectedRoute = createRouteMatcher([
  "/home(.*)",
  "/deals(.*)",
  "/underwriting(.*)",
  "/api/deals(.*)",
  "/api/evidence(.*)",
  "/api/ownership(.*)",
  "/api/pack(.*)",
  "/api/conditions(.*)",
  "/api/timeline(.*)",
  "/api/command(.*)",
  "/api/intelligence(.*)",
]);

// Auth pages (sign-in/sign-up)
const isAuthRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

// Public routes that don't require auth
const isPublicRoute = createRouteMatcher([
  "/api/health(.*)",
  "/api/ping(.*)",
  "/clerk-test(.*)",
  "/borrower/(.*)", // Borrower portal public entry
  "/portal/invite(.*)", // Portal invite public
  "/portal/public(.*)",
  "/s(.*)", // public shareable screen links
  "/share(.*)", // Stitch public share
  "/stitch-login(.*)", // Stitch login demo
  "/stitch-generate(.*)", // Stitch generate demo
  "/generate(.*)", // public screen generator page
  "/api/generate(.*)", // public screen generation API
  "/api/screens(.*)", // public screen view/claim/continue APIs
  "/api/borrower/(.*)", // Borrower API public
  "/upgrade(.*)", // upgrade page
  "/select-bank(.*)", // bank selection flow
  "/api/banks(.*)", // bank selection API
  "/api/profile/bank(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();
  const { pathname } = req.nextUrl;

  // Invite-only gate: block /sign-up when BUDDY_INVITE_ONLY=true
  if (
    process.env.BUDDY_INVITE_ONLY === "true" &&
    pathname.startsWith("/sign-up") &&
    !userId
  ) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  // Public routes - allow through (check early to avoid footguns)
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  // Protect application routes - redirect to sign-in with return URL
  if (isProtectedRoute(req) && !userId) {
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect_url", pathname + req.nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  // Keep signed-in users out of auth pages - redirect to intended destination
  if (isAuthRoute(req) && userId) {
    const redirectUrl = req.nextUrl.searchParams.get("redirect_url");
    const safeTarget = redirectUrl?.startsWith("/") ? redirectUrl : "/";
    return NextResponse.redirect(new URL(safeTarget, req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!.*\\..*|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
