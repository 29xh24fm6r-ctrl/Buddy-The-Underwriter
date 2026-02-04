import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isValidClerkPublishableKey } from "@/lib/auth/isValidClerkKey";

const clerkReady =
  isValidClerkPublishableKey(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
  !!process.env.CLERK_SECRET_KEY;

// When Clerk is configured, clerkMiddleware() sets up the auth context so
// auth() resolves reliably in server components and API route handlers.
// It does NOT block any routes by default — protection is handled in layouts
// and route handlers via getCurrentBankId() / tryGetCurrentBankId().
export default clerkReady
  ? clerkMiddleware()
  : (_req: NextRequest) => NextResponse.next();

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
