// middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health(.*)",
  "/api/ping(.*)",
  "/clerk-test(.*)",
  "/borrower/(.*)", // Borrower portal public entry
  "/portal/invite(.*)", // Portal invite public
  "/portal/public(.*)",
]);

const isBankSelectionRoute = createRouteMatcher([
  "/select-bank(.*)",
]);

const isBankSelectionAPI = createRouteMatcher([
  "/api/banks(.*)",
  "/api/profile/bank(.*)",
  "/api/borrower/(.*)", // Borrower API public
]);

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();
  const { pathname } = req.nextUrl;

  // Root should always go to /sign-in if unauth, else /deals
  if (pathname === "/") {
    if (!userId) {
      return NextResponse.redirect(new URL("/sign-in", req.url));
    }
    return NextResponse.redirect(new URL("/deals", req.url));
  }

  // Invite-only gate: block /sign-up when BUDDY_INVITE_ONLY=true
  if (
    process.env.BUDDY_INVITE_ONLY === "true" &&
    pathname.startsWith("/sign-up") &&
    !userId
  ) {
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  // Public routes and bank selection flow don't require auth
  if (isPublicRoute(req) || isBankSelectionRoute(req) || isBankSelectionAPI(req)) {
    return NextResponse.next();
  }

  // Protect all other routes - redirect unauth to sign-in
  if (!userId) {
    const url = new URL("/sign-in", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
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
