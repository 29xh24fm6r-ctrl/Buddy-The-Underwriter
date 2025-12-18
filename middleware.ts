import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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

  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!.*\\..*|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
