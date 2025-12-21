// middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",                         // we'll redirect "/" → "/sign-in" below, but keep it public
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health(.*)",
  "/portal/invite(.*)",        // borrower invite links if you have them
  "/portal/public(.*)",
  "/_next(.*)",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
]);

export default clerkMiddleware((auth, req) => {
  const { pathname } = req.nextUrl;

  // Force root to be login entry (your requirement)
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }

  // Protect all non-public routes
  if (!isPublicRoute(req)) {
    auth().protect();
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Run middleware on all routes except static assets
    "/((?!.*\\..*|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
