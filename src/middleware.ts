import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/api/health(.*)",
  "/api/ping(.*)",
  "/clerk-test(.*)",
]);

const isSignUpRoute = createRouteMatcher([
  "/sign-up(.*)",
]);

const isBankSelectionRoute = createRouteMatcher([
  "/select-bank(.*)",
]);

const isBankSelectionAPI = createRouteMatcher([
  "/api/banks(.*)",
  "/api/profile/bank(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();

  // Invite-only gate: block /sign-up when BUDDY_INVITE_ONLY=true
  if (
    process.env.BUDDY_INVITE_ONLY === "true" &&
    isSignUpRoute(req) &&
    !userId
  ) {
    return Response.redirect(new URL("/sign-in", req.url));
  }

  // Public routes and bank selection flow don't require auth
  if (isPublicRoute(req) || isBankSelectionRoute(req) || isBankSelectionAPI(req)) {
    if (!isPublicRoute(req)) {
      await auth.protect();
    }
    return NextResponse.next();
  }

  // Protect all other routes
  await auth.protect();
});

export const config = {
  matcher: [
    "/((?!.*\\..*|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
