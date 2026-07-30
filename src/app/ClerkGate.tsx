"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ClerkProvider } from "@clerk/nextjs";
import { isValidClerkPublishableKey } from "@/lib/auth/isValidClerkKey";
import { isPublicBorrowerRoute } from "@/lib/navigation/isPublicBorrowerRoute";
import { isClerkHost } from "@/lib/navigation/clerkHosts";

// Host gating (marketing domains where clerk-js can't initialize) lives in
// @/lib/navigation/clerkHosts so ClerkGate and the edge middleware share one
// source of truth: the middleware redirects auth-requiring routes off these
// hosts, and ClerkGate declines to mount <ClerkProvider> on them.

export default function ClerkGate({ children }: { children: React.ReactNode }) {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const pathname = usePathname();

  // window/hostname is unavailable during SSR and static prerender, so defer
  // the host check until after hydration — the server and first client
  // render both mount ClerkProvider (today's behavior), then a marketing
  // host/route drops it on the next tick.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ✅ In CI / preview builds we often use placeholder env vars.
  // If the key is invalid, do NOT mount ClerkProvider (prevents prerender crash).
  if (!isValidClerkPublishableKey(pk)) return <>{children}</>;

  const isAuthPage =
    pathname === "/sign-in" ||
    pathname?.startsWith("/sign-in/") ||
    pathname === "/sign-up" ||
    pathname?.startsWith("/sign-up/");

  // isPublicBorrowerRoute is pathname-only (no window access), so it's safe
  // to evaluate on the very first render — SSR and initial client hydration
  // alike — unlike the hostname check below. That closes the one-tick gap
  // where ClerkProvider used to mount-then-unmount on every public borrower
  // route: clerk-js kicks off its script load + auth API call as soon as it
  // mounts, and neither is cancelled by the unmount on the next tick, so the
  // brief mount alone was enough to trip Clerk's domain-mismatch rejection
  // in the browser console on every visit.
  const shouldSkipClerk =
    !isAuthPage &&
    (isPublicBorrowerRoute(pathname) ||
      (mounted && !isClerkHost(window.location.hostname)));

  if (shouldSkipClerk) return <>{children}</>;

  return (
    <ClerkProvider publishableKey={pk} afterSignOutUrl="/">
      {children}
    </ClerkProvider>
  );
}
